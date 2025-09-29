import { pipeline } from 'node:stream/promises'
import { createHash } from 'node:crypto'
import { Volume } from 'memfs'
import isBinaryPath from 'is-binary-path'

export type FileCompareResult =
  | { text: boolean; hash: [actual: string, expected: string] }
  | { text: boolean; size: [actual: number, expected: number] }
  | { text: boolean; buffer: [actual: Buffer, expected: Buffer] }

const BUFFER_DIFF_THRESHOLD = 2.5 * 1024 * 1024 // 2.5 MB
const SYNC_COMPARE_THRESHOLD = 16 * 1024 * 1024 // 16 MB
const STREAM_THRESHOLD = 32 * 1024 * 1024 // 32 MB

/**
 * Utility around fs/memfs file access that tracks size and chooses between
 * buffered operations and streaming work for comparisons and copies.
 */
export class FileHandle {
  private readonly fs: typeof import('fs')
  readonly path: string
  size: number

  constructor(fsLike: Volume | typeof import('fs'), fsPath: string, size: number) {
    this.fs = fsLike as any
    this.path = fsPath
    this.size = size
  }

  /**
   * Compare against another handle using async reads and hashing; obeys abort signals.
   */
  async compare(target: FileHandle, signal?: AbortSignal): Promise<FileCompareResult | null> {
    const size = Math.max(this.size, target.size)
    const text = isText(this.path)
    if (size > STREAM_THRESHOLD) {
      if (this.size !== target.size) {
        return { text, size: [this.size, target.size] }
      }

      const [actual, expected] = await Promise.all([this.makeHash(signal), target.makeHash(signal)])
      if (actual === ABORT_HASH || expected === ABORT_HASH) {
        // hash operation was aborted
        return { text, hash: makeAbortDiff(actual, expected) }
      }

      return actual === expected ? null : { text, hash: [actual, expected] }
    }

    const [data, targetData] = await Promise.all([this.read(signal), target.read(signal)])
    if (data === ABORT_READ || targetData === ABORT_READ) {
      // read operation was aborted
      return this.makeDiff(...makeAbortDiff(data, targetData))
    }

    return data.equals(targetData) ? null : this.makeDiff(data, targetData)
  }

  /**
   * Compare synchronously; throws if either file exceeds the sync threshold.
   */
  compareSync(target: FileHandle): FileCompareResult | null {
    const data = this.readSync()
    const targetData = target.readSync()
    if (data.equals(targetData)) {
      return null
    }

    return this.makeDiff(data, targetData)
  }

  /**
   * Overwrite this file with data from another handle, streaming for large sources.
   */
  async replaceWith(target: FileHandle, signal?: AbortSignal) {
    if (target.size > STREAM_THRESHOLD) {
      const chunkSize = 512 * 1024
      const src = target.fs.createReadStream(target.path, { highWaterMark: chunkSize, signal })
      const dest = this.fs.createWriteStream(this.path, { highWaterMark: chunkSize, signal })
      await pipeline(src, dest)
      this.size = target.size
      return
    }

    return this.write(await target.read(signal), signal)
  }

  /**
   * Persist raw data to this handle and keep the cached size in sync.
   */
  async write(data: Buffer, signal?: AbortSignal) {
    if (this.fs instanceof Volume) {
      this.fs.writeFileSync(this.path, data)
    } else {
      await this.fs.promises.writeFile(this.path, data, { signal })
    }
    this.size = data.length
  }

  private async read(signal?: AbortSignal): Promise<Buffer> {
    return this.fs instanceof Volume
      ? // data is already in memory, no need for async here
        this.fs.readFileSync(this.path)
      : gracefulAbort(this.fs.promises.readFile(this.path, { signal }), signal, ABORT_READ)
  }

  private readSync(): Buffer {
    if (this.size > SYNC_COMPARE_THRESHOLD) {
      throw new Error(
        `compareSync(): File size exceeds sync threshold (${formatMB(SYNC_COMPARE_THRESHOLD)})\n` +
          `- ${this.path}: ${formatMB(this.size)}\n` +
          `Use { async: true } to enable async matching`,
      )
    }

    return this.fs.readFileSync(this.path)
  }

  private makeHashSync(data: Buffer) {
    return createHash('md5').update(data).digest('hex')
  }

  private async makeHash(signal?: AbortSignal) {
    const chunkSize = 512 * 1024
    const hash = createHash('md5')
    const stream = this.fs.createReadStream(this.path, { highWaterMark: chunkSize, signal })
    try {
      for await (const chunk of stream) {
        hash.update(chunk)
      }
      return hash.digest().toString('hex')
    } catch (err) {
      // graceful abort
      if (err.name === 'AbortError') {
        return ABORT_HASH
      }
      throw err
    } finally {
      stream.destroy()
    }
  }

  private makeDiff(data: Buffer, targetData: Buffer): FileCompareResult {
    const size = Math.max(data.length, targetData.length)
    if (size > BUFFER_DIFF_THRESHOLD) {
      // if the file is too big, return hash diff
      return {
        text: isText(this.path),
        hash: [this.makeHashSync(data), this.makeHashSync(targetData)],
      }
    }

    const text = isText(this.path)
    const [actual, expected] = this.makeBufferDiff(data, targetData, text ? 128 : 64)
    return { text, buffer: [actual, expected] }
  }

  private makeBufferDiff(data: Buffer, targetData: Buffer, size: number): [Buffer, Buffer] {
    const len = Math.min(data.length, targetData.length)
    let diffIndex = len
    for (let i = 0; i < len; i++) {
      if (data[i] !== targetData[i]) {
        diffIndex = i
        break
      }
    }

    const half = Math.floor(size / 2)
    const start = diffIndex > half ? diffIndex - half : 0
    const end = Math.min(
      Math.max(start + size, diffIndex + 1),
      Math.max(data.length, targetData.length),
    )
    return [
      data.subarray(start, Math.min(end, data.length)),
      targetData.subarray(start, Math.min(end, targetData.length)),
    ]
  }
}

function isText(filePath: string) {
  return !isBinaryPath(filePath)
}

function formatMB(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

async function gracefulAbort<R = void>(promise: Promise<R>, signal: AbortSignal, fallback?: R) {
  if (!signal) return promise
  return promise.catch((err) => {
    if (err.name === 'AbortError') return fallback
    throw err
  })
}

export function makeAbortDiff<T>(a: T, b: T): [T, T] {
  if (a === b)
    return typeof b === 'string'
      ? [a, '__FILE_HANDLE_ABORT_HASH_2__' as T]
      : [a, Buffer.from('__FILE_HANDLE_ABORT_READ_2__') as T]
  return [a, b]
}

const ABORT_READ = Buffer.from('__FILE_HANDLE_ABORT_READ__')
const ABORT_HASH = '__FILE_HANDLE_ABORT_HASH__'

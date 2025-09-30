import { pipeline } from 'node:stream/promises'
import { createHash } from 'node:crypto'
import { Volume } from 'memfs'
import isBinaryPath from 'is-binary-path'

/**
 * Result payloads returned by {@link FileHandle.compare} when a
 * mismatch is detected. When files match, `null` is returned instead.
 * @internal
 */
export type FileCompareResult =
  | { text: boolean; hash: [actual: string, expected: string] }
  | { text: boolean; size: [actual: number, expected: number] }
  | { text: boolean; buffer: [actual: Buffer, expected: Buffer] }

const BUFFER_DIFF_THRESHOLD = 2.5 * 1024 * 1024 // 2.5 MB
const SYNC_THRESHOLD = 16 * 1024 * 1024 // 16 MB
const STREAM_THRESHOLD = 32 * 1024 * 1024 // 32 MB

/**
 * Lightweight wrapper over Node `fs` or `memfs` volumes that tracks size and
 * abstracts comparison/copy logic with smart fallbacks (stream vs buffer).
 * @internal
 */
export class FileHandle {
  /** Underlying fs implementation (Node `fs` or memfs `Volume`). */
  readonly fs: typeof import('fs')
  /** Absolute path of the wrapped file. */
  readonly path: string
  private _size: number

  /**
   * @param fsLike Backing storage used for all I/O operations.
   * @param fsPath Absolute path to the file within `fsLike`.
   * @param size Initial byte length cache; kept in sync by mutating methods.
   */
  constructor(fsLike: Volume | typeof import('fs'), fsPath: string, size: number) {
    this.fs = fsLike as any
    this.path = fsPath
    this._size = size
  }

  /** Current byte length; used to pick comparison strategies. */
  get size() {
    return this._size
  }

  /** Returns `true` when the handle is backed by an in-memory volume. */
  get isVirtual() {
    return this.fs instanceof Volume
  }

  /** Indicates whether the handle is treated as text when building diffs. */
  get isText() {
    return !isBinaryPath(this.path)
  }

  /**
   * Compare against another handle using async reads and hashing; obeys abort
   * signals. Returns `null` when contents match.
   */
  async compare(target: FileHandle, signal?: AbortSignal): Promise<FileCompareResult | null> {
    const size = Math.max(this._size, target._size)
    const text = this.isText
    if (size > STREAM_THRESHOLD) {
      if (this._size !== target._size) {
        return { text, size: [this._size, target._size] }
      }

      const [actual, expected] = await Promise.all([
        gracefulAbort(this.makeHash(signal), signal, ABORT_HASH),
        gracefulAbort(target.makeHash(signal), signal, ABORT_HASH),
      ])
      if (actual === ABORT_HASH || expected === ABORT_HASH) {
        // hash operation was aborted
        return { text, hash: makeAbortDiff(actual, expected) }
      }

      return actual === expected ? null : { text, hash: [actual, expected] }
    }

    const [data, targetData] = await Promise.all([
      gracefulAbort(this.read(signal), signal, ABORT_READ),
      gracefulAbort(target.read(signal), signal, ABORT_READ),
    ])
    if (data === ABORT_READ || targetData === ABORT_READ) {
      // read operation was aborted
      return this.makeDiff(...makeAbortDiff(data, targetData))
    }

    return data.equals(targetData) ? null : this.makeDiff(data, targetData)
  }

  /**
   * Compare synchronously; throws if either file exceeds the sync threshold.
   * Returns `null` when contents match.
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
   * Overwrite this file with data from another handle, streaming for large
   * sources. Updates the cached `size` after completion.
   */
  async replaceWith(target: FileHandle, signal?: AbortSignal) {
    if (target._size > STREAM_THRESHOLD) {
      const chunkSize = 512 * 1024
      const src = target.fs.createReadStream(target.path, { highWaterMark: chunkSize, signal })
      const dest = this.fs.createWriteStream(this.path, { highWaterMark: chunkSize, signal })
      await pipeline(src, dest)
      this._size = target._size
      return
    }

    return this.write(await target.read(signal), signal)
  }

  /** Persist raw data to this handle and keep the cached size in sync. */
  async write(data: Buffer, signal?: AbortSignal) {
    if (this.isVirtual) {
      this.fs.writeFileSync(this.path, data)
    } else {
      await this.fs.promises.writeFile(this.path, data, { signal })
    }
    this._size = data.length
  }

  async read(signal?: AbortSignal): Promise<Buffer> {
    return this.isVirtual
      ? // data is already in memory, no need for async here
        this.fs.readFileSync(this.path)
      : this.fs.promises.readFile(this.path, { signal })
  }

  readSync(): Buffer {
    if (this._size > SYNC_THRESHOLD) {
      throw new Error(
        `readSync(): File size exceeds sync threshold (${formatMB(SYNC_THRESHOLD)})\n` +
          `- ${this.path}: ${formatMB(this._size)}`,
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
    } finally {
      stream.destroy()
    }
  }

  private makeDiff(data: Buffer, targetData: Buffer): FileCompareResult {
    const size = Math.max(data.length, targetData.length)
    if (size > BUFFER_DIFF_THRESHOLD) {
      // if the file is too big, return hash diff
      return {
        text: this.isText,
        hash: [this.makeHashSync(data), this.makeHashSync(targetData)],
      }
    }

    const text = this.isText
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

function makeAbortDiff<T>(a: T, b: T): [T, T] {
  if (a === b)
    return typeof b === 'string'
      ? [a, '__FILE_HANDLE_ABORT_HASH_2__' as T]
      : [a, Buffer.from('__FILE_HANDLE_ABORT_READ_2__') as T]
  return [a, b]
}

const ABORT_READ = Buffer.from('__FILE_HANDLE_ABORT_READ__')
const ABORT_HASH = '__FILE_HANDLE_ABORT_HASH__'

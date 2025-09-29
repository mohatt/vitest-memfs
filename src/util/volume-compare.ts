import pLimit from 'p-limit'
import type { VolumeMap, VolumeEntry } from './volume.js'
import type { FileCompareResult } from './file-handle.js'

export type VolumeCompareListMatch =
  | 'exact' // directory contents must match exactly (default)
  | 'ignore-extra' // extra files in the received volume are ignored
  | 'ignore-missing' // missing files in the received volume are ignored

export type VolumeCompareContentMatch =
  | 'all' // compare file contents + symlink targets (default)
  | 'ignore' // ignore both, only check path + type
  | 'ignore-files' // only ignore file content comparison
  | 'ignore-symlinks' // only ignore symlink targets

export type VolumeCompareReportType =
  | 'first' // stop on the first mismatch (default)
  | 'all' // collect all mismatches and show a combined diff

export interface VolumeCompareOptions<Async extends boolean = boolean> {
  // How to match the directory structure of the received volume to the expected volume.
  listMatch?: VolumeCompareListMatch
  // How to match the file contents of the received volume to the expected volume.
  contentMatch?: VolumeCompareContentMatch
  // How to report mismatches between the received volume and the expected volume.
  report?: VolumeCompareReportType
  // Whether to run the comparison asynchronously.
  // Defaults to `false` to allow synchronous matching.
  // Useful for volumes with large file contents.
  async?: Async
  // Optional concurrency limit for async comparisons. Defaults to `16`.
  concurrency?: number
  // Optional abort signal to cancel async comparison.
  abortSignal?: AbortSignal
}

type VolumeCompareResult =
  | { pass: true }
  | { pass: false; message: () => string; actual: DiffEntry; expected: DiffEntry }

type DiffEntry = Directory | File | BinaryFile | Symlink

enum DiffKind {
  Match = 0,
  TypeMismatch = 1,
  FileMismatch = 2,
  SymlinkMismatch = 3,
  Missing = 4,
  Extra = 5,
}

type DiffResult =
  | { kind: DiffKind.Match; exp?: never | undefined; act?: never | undefined }
  | { kind: DiffKind.TypeMismatch; exp: DiffEntry; act: DiffEntry }
  | { kind: DiffKind.FileMismatch; exp: DiffEntry; act: DiffEntry }
  | { kind: DiffKind.SymlinkMismatch; exp: DiffEntry; act: DiffEntry }
  | { kind: DiffKind.Missing; exp: DiffEntry; act?: never | undefined }
  | { kind: DiffKind.Extra; exp?: never | undefined; act: DiffEntry }

interface DeferredDiffResult {
  kind: 'deferred'
  sync: () => DiffResult
  async: (signal?: AbortSignal) => Promise<DiffResult>
}

type AsyncReturn<T, Async extends boolean> = Async extends true ? T | Promise<T> : T

/**
 * Compare two volume maps with optional async mode and configurable reporting.
 */
export class VolumeCompare<Async extends boolean = false> {
  private readonly options: VolumeCompareOptions<Async>
  private readonly compareFiles: boolean
  private readonly compareSymlinks: boolean
  private readonly ignoreMissingPaths: boolean
  private readonly ignoreExtraPaths: boolean

  constructor(
    private readonly received: VolumeMap,
    private readonly expected: VolumeMap,
    options?: VolumeCompareOptions<Async>,
  ) {
    this.options = options ?? {}
    const { listMatch, contentMatch } = this.options
    this.compareFiles = contentMatch !== 'ignore' && contentMatch !== 'ignore-files'
    this.compareSymlinks = contentMatch !== 'ignore' && contentMatch !== 'ignore-symlinks'
    this.ignoreMissingPaths = listMatch === 'ignore-missing'
    this.ignoreExtraPaths = listMatch === 'ignore-extra'
  }

  /**
   * Run the comparison, respecting the chosen report mode and async setting.
   */
  compare() {
    if (this.options.report === 'all') {
      return this.compareAll() as AsyncReturn<VolumeCompareResult, Async>
    }

    return this.compareFirst() as AsyncReturn<VolumeCompareResult, Async>
  }

  /**
   * Stop on the first mismatch.
   * Returns a promise when async mode is enabled.
   */
  private compareFirst(): VolumeCompareResult | Promise<VolumeCompareResult> {
    const { received, expected, ignoreExtraPaths, ignoreMissingPaths } = this
    // make sorted arrays for error reporting and better diffing
    const actualFiles = Object.keys(received).sort()
    const expectedFiles = Object.keys(expected).sort()

    let listMismatch: {
      reason: string
      actual: string[]
      expected: string[]
    } | null = null

    if (ignoreExtraPaths) {
      const missing = expectedFiles.filter((f) => !(f in received))
      if (missing.length > 0) {
        listMismatch = {
          reason: `Volume is missing ${missing.length} expected file${missing.length > 1 ? 's' : ''}`,
          actual: actualFiles.filter((f) => f in expected),
          expected: expectedFiles,
        }
      }
    } else if (ignoreMissingPaths) {
      const extra = actualFiles.filter((f) => !(f in expected))
      if (extra.length > 0) {
        listMismatch = {
          reason: `Volume has ${extra.length} unexpected file${extra.length > 1 ? 's' : ''}`,
          actual: actualFiles,
          expected: expectedFiles.filter((f) => f in received),
        }
      }
    } else if (
      actualFiles.length !== expectedFiles.length ||
      !actualFiles.every((f, i) => f === expectedFiles[i])
    ) {
      listMismatch = {
        reason: 'Directory structure didn’t match',
        actual: actualFiles,
        expected: expectedFiles,
      }
    }

    if (listMismatch) {
      return {
        pass: false,
        message: () => listMismatch.reason,
        actual: listMismatch.actual,
        expected: listMismatch.expected,
      }
    }

    const filesToCheck = ignoreMissingPaths ? actualFiles : expectedFiles
    const diffResult = this.matchEntries(
      filesToCheck,
      (file, { kind, exp, act }): VolumeCompareResult => {
        if (kind === DiffKind.TypeMismatch) {
          return {
            pass: false,
            message: () => `Found path type mismatch at \`${file}\``,
            actual: act,
            expected: exp,
          }
        }
        if (kind === DiffKind.FileMismatch) {
          return {
            pass: false,
            message: () => `Found file content mismatch at \`${file}\``,
            actual: act,
            expected: exp,
          }
        }
        if (kind === DiffKind.SymlinkMismatch) {
          return {
            pass: false,
            message: () => `Found symlink target mismatch at \`${file}\``,
            actual: act,
            expected: exp,
          }
        }
        return null
      },
    )

    function createResult(result: VolumeCompareResult): VolumeCompareResult {
      return result ?? { pass: true }
    }

    return diffResult instanceof Promise ? diffResult.then(createResult) : createResult(diffResult)
  }

  /**
   * Collect every mismatch and build a merged diff payload.
   * Returns a promise when async mode is enabled.
   */
  private compareAll(): VolumeCompareResult | Promise<VolumeCompareResult> {
    const { received, expected, ignoreExtraPaths, ignoreMissingPaths } = this
    const actualDiff: Record<string, DiffEntry> = {}
    const expectedDiff: Record<string, DiffEntry> = {}
    let missingCount = 0
    let extraCount = 0
    let contentCount = 0
    let typeCount = 0

    const pathsToCheck = ignoreExtraPaths
      ? expected
      : ignoreMissingPaths
        ? received
        : { ...received, ...expected }
    const diffResult = this.matchEntries(Object.keys(pathsToCheck), (p, { kind, exp, act }) => {
      switch (kind) {
        case DiffKind.TypeMismatch:
          expectedDiff[p] = exp
          actualDiff[p] = act
          typeCount++
          break
        case DiffKind.FileMismatch:
        case DiffKind.SymlinkMismatch:
          expectedDiff[p] = exp
          actualDiff[p] = act
          contentCount++
          break
        case DiffKind.Missing:
          if (!ignoreMissingPaths) {
            expectedDiff[p] = exp
            missingCount++
          }
          break
        case DiffKind.Extra:
          if (!ignoreExtraPaths) {
            actualDiff[p] = act
            extraCount++
          }
          break
        case DiffKind.Match:
        default:
          actualDiff[p] = {}
          expectedDiff[p] = {}
      }
    })

    function createResult(): VolumeCompareResult {
      const total = missingCount + extraCount + contentCount + typeCount
      if (total > 0) {
        const parts: string[] = []
        if (missingCount) parts.push(`${missingCount} missing path${missingCount > 1 ? 's' : ''}`)
        if (extraCount) parts.push(`${extraCount} unexpected path${extraCount > 1 ? 's' : ''}`)
        if (typeCount) parts.push(`${typeCount} path type mismatch${typeCount > 1 ? 'es' : ''}`)
        if (contentCount) parts.push(`${contentCount} mismatched content`)

        return {
          pass: false,
          message: () =>
            parts.length === 1
              ? `Found ${parts[0]}` //
              : `Found ${total} mismatches: ${parts.join(', ')}`,
          actual: actualDiff,
          expected: expectedDiff,
        }
      }

      return { pass: true }
    }

    return diffResult instanceof Promise ? diffResult.then(createResult) : createResult()
  }

  /**
   * Iterate paths and feed diffs into the provided callback, handling sync vs async work.
   */
  private matchEntries<R = void>(
    paths: string[],
    callback: (path: string, diff: DiffResult) => R,
  ): R | Promise<R | undefined> {
    if (!this.options.async) {
      const deferred: Array<() => R> = []
      for (const path of paths) {
        const exp = this.expected[path]
        const act = this.received[path]
        const diff = this.matchEntry(exp, act)
        if (diff.kind === 'deferred') {
          deferred.push(() => callback(path, diff.sync()))
          continue
        }
        const result = callback(path, diff)
        if (result) return result
      }

      for (const cb of deferred) {
        const result = cb()
        if (result) return result
      }

      return undefined
    }

    const limit = pLimit(this.options.concurrency ?? 32)
    const controller = new AbortController()
    const signal = this.options.abortSignal
      ? AbortSignal.any([controller.signal, this.options.abortSignal])
      : controller.signal

    return new Promise<R | undefined>((resolve, reject) => {
      let pending = 0
      let done = false

      function finish(value?: R | undefined, error?: unknown) {
        if (done) return
        done = true
        controller.abort()
        limit.clearQueue()
        if (error) {
          reject(error)
        } else {
          resolve(value)
        }
      }

      for (const path of paths) {
        if (done) break
        const exp = this.expected[path]
        const act = this.received[path]
        const diff = this.matchEntry(exp, act)

        if (diff.kind === 'deferred') {
          pending++
          limit(async () => {
            try {
              const diffResult = await diff.async(signal)
              if (done) return
              const result = callback(path, diffResult)
              if (result) {
                finish(result)
              } else if (--pending === 0) {
                finish(undefined)
              }
            } catch (err) {
              finish(undefined, err)
            }
          })
          continue
        }

        const result = callback(path, diff)
        if (result) {
          finish(result)
          break
        }
      }

      if (!done && pending === 0) {
        finish(undefined)
      }
    })
  }

  /**
   * Produce an immediate or a deferred diff for a single path.
   */
  private matchEntry(exp: VolumeEntry, act: VolumeEntry): DiffResult | DeferredDiffResult {
    if (exp && !act) {
      return { kind: DiffKind.Missing, exp: this.getEmptyDiff(exp) }
    }

    if (act && !exp) {
      return { kind: DiffKind.Extra, act: this.getEmptyDiff(act) }
    }

    if (exp.kind !== act.kind) {
      return {
        kind: DiffKind.TypeMismatch,
        exp: this.getEmptyDiff(exp),
        act: this.getEmptyDiff(act),
      }
    }

    if (
      exp.kind === 'symlink' &&
      this.compareSymlinks &&
      exp.target !== (act as typeof exp).target
    ) {
      return {
        kind: DiffKind.SymlinkMismatch,
        exp: new Symlink(exp.target),
        act: new Symlink((act as typeof exp).target),
      }
    }

    if (exp.kind === 'file' && this.compareFiles) {
      return {
        kind: 'deferred',
        sync: () => {
          const fileDiff = exp.file.compareSync((act as typeof exp).file)
          return fileDiff != null ? this.makeFileDiff(fileDiff) : { kind: DiffKind.Match }
        },
        async: async (signal) => {
          const fileDiff = await exp.file.compare((act as typeof exp).file, signal)
          return fileDiff != null ? this.makeFileDiff(fileDiff) : { kind: DiffKind.Match }
        },
      }
    }

    return { kind: DiffKind.Match }
  }

  private makeFileDiff(diff: FileCompareResult): DiffResult {
    let exp: DiffEntry
    let act: DiffEntry
    const Type = diff.text ? File : BinaryFile

    if ('buffer' in diff) {
      exp = new Type(diff.buffer[0])
      act = new Type(diff.buffer[1])
    } else if ('hash' in diff) {
      exp = new Type(null, diff.hash[0])
      act = new Type(null, diff.hash[1])
    } else {
      exp = new Type(null, null, diff.size[0])
      act = new Type(null, null, diff.size[1])
    }

    return { kind: DiffKind.FileMismatch, exp, act }
  }

  private getEmptyDiff(entry: VolumeEntry): DiffEntry {
    if (entry.kind === 'empty-dir') {
      return EMPTY_DIR_MARKER
    }

    if (entry.kind === 'file') {
      return EMPTY_FILE_MARKER
    }

    return EMPTY_SYMLINK_MARKER
  }
}

class Directory {}

class File {
  declare data?: string
  declare size?: number
  declare hash?: string
  constructor(data?: Buffer, hash?: string, size?: number) {
    if (data != null) this.data = data.toString('utf-8')
    if (size != null) this.size = size
    if (hash != null) this.hash = hash
  }
}

class BinaryFile {
  declare data?: string
  declare size?: number
  declare hash?: string
  constructor(data?: Buffer, hash?: string, size?: number) {
    if (data != null) this.data = data.toString('base64')
    if (size != null) this.size = size
    if (hash != null) this.hash = hash
  }
}

class Symlink {
  declare target?: string
  constructor(target?: string) {
    if (target != null) this.target = target
  }
}

const EMPTY_DIR_MARKER = Object.freeze(new Directory())
const EMPTY_FILE_MARKER = Object.freeze(new File())
const EMPTY_SYMLINK_MARKER = Object.freeze(new Symlink())

import path from 'node:path'
import pLimit from 'p-limit'
import { toRegex } from 'glob-to-regex.js'
import type { Volume } from 'memfs'
import { importActualFS, resolveAbsPath, isGlobLike } from './common.js'
import { FileHandle } from './file-handle.js'

/**
 * Normalized entry used by comparison helpers to describe a file system node.
 * @internal
 */
export type VolumeEntry =
  | { kind: 'file'; file: FileHandle }
  | { kind: 'symlink'; target: string }
  | { kind: 'empty-dir' }

/**
 * Map of absolute POSIX paths to their corresponding volume entries.
 * @internal
 */
export interface VolumeMap {
  [path: string]: VolumeEntry
}

/**
 * Options that influence how a memfs volume is traversed.
 */
export interface VolumeToMapOptions {
  prefix?: string
  ignore?: string | string[]
}

/**
 * Convert a memfs volume into a {@link VolumeMap}, walking from `prefix`
 * and skipping any paths matched by `ignore` (strings or globs).
 * @internal
 */
export function volumeToMap(volume: Volume, options?: VolumeToMapOptions) {
  const { prefix = '/', ignore } = options ?? {}
  const shouldIgnore = createIgnoreMatcher(ignore, prefix)
  const map: VolumeMap = Object.create(null)

  function walk(curr: string) {
    if (shouldIgnore(curr)) return
    const stats = volume.lstatSync(curr)

    if (stats.isDirectory()) {
      const list = volume.readdirSync(curr) as string[]
      if (list.length === 0) map[curr] = { kind: 'empty-dir' }
      for (const name of list) {
        walk(path.posix.join(curr, name))
      }
    } else if (stats.isFile()) {
      map[curr] = {
        kind: 'file', //
        file: new FileHandle(volume, curr, stats.size),
      }
    } else if (stats.isSymbolicLink()) {
      map[curr] = {
        kind: 'symlink', //
        target: volume.readlinkSync(curr) as string,
      }
    }
  }

  walk(prefix)
  return map
}

/**
 * Extends {@link VolumeToMapOptions} with knobs for host filesystem reads.
 * @internal
 */
export interface ReadDirToMapOptions extends VolumeToMapOptions {
  concurrency?: number
}

/**
 * Read a real directory into a {@link VolumeMap}, mirroring `volumeToMap`
 * for the host filesystem with optional concurrency control.
 * @internal
 */
export async function readDirToMap(targetDirPath: string, options?: ReadDirToMapOptions) {
  const fs = await importActualFS()
  const { prefix = '/', ignore, concurrency = 48 } = options ?? {}
  const shouldIgnore = createIgnoreMatcher(ignore, prefix)
  const map: VolumeMap = Object.create(null)

  const limit = pLimit(concurrency)

  async function walk(dirPath: string) {
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true })
    const key = normalizeRelative(targetDirPath, dirPath, prefix)
    if (shouldIgnore(key)) return
    if (entries.length === 0) {
      map[key] = { kind: 'empty-dir' }
    }

    await Promise.all(
      entries.map(async (entry) => {
        const abs = path.join(dirPath, entry.name)
        const key = normalizeRelative(targetDirPath, abs, prefix)
        if (shouldIgnore(key)) return

        if (entry.isDirectory()) {
          await walk(abs)
        } else if (entry.isFile()) {
          const { size } = await limit(() => fs.promises.lstat(abs))
          map[key] = {
            kind: 'file',
            file: new FileHandle(fs, abs, size),
          }
        } else if (entry.isSymbolicLink()) {
          map[key] = {
            kind: 'symlink',
            target: normalizeLinkTarget(await limit(() => fs.promises.readlink(abs))),
          }
        }
      }),
    )
  }

  await walk(targetDirPath)
  return map
}

function normalizeRelative(from: string, to: string, prefix = '/') {
  const rel = path.relative(from, to)
  const relPosix = path.sep === '/' ? rel : rel.split(path.sep).join('/')
  return path.posix.join(prefix, relPosix)
}

function normalizeLinkTarget(target: string) {
  if (path.sep !== '/') {
    const slice = /^[A-Za-z]:/.test(target) ? target.slice(2) : target
    return slice.split(path.sep).join('/')
  }
  return target
}

/**
 * Extends {@link VolumeToMapOptions} with controls for persisting volumes.
 * @internal
 */
export interface WriteVolumeToDirOptions extends VolumeToMapOptions {
  clear?: boolean
  withData?: boolean
  concurrency?: number
}

/**
 * Mirror a memfs volume on disk, optionally clearing the target,
 * writing file contents, and throttling concurrent operations.
 * @internal
 */
export async function writeVolumeToDir(
  volume: Volume,
  targetDirPath: string,
  options?: WriteVolumeToDirOptions,
) {
  const fs = await importActualFS()
  const { prefix = '/', ignore, clear, withData = true, concurrency = 32 } = options ?? {}
  const map = volumeToMap(volume, { prefix, ignore })

  if (clear) {
    await fs.promises.rm(targetDirPath, { recursive: true, force: true })
  }

  const writeDirs = new Set<string>()
  const writeOps: Array<() => Promise<void>> = []

  for (const abs in map) {
    // strip prefix
    const rel = abs.slice(prefix.length)
    const targetPath = path.join(targetDirPath, rel)
    const entry = map[abs]

    if (entry.kind === 'file') {
      writeDirs.add(path.dirname(targetPath))
      writeOps.push(() => {
        const file = new FileHandle(fs, targetPath, 0)
        if (withData) {
          return file.replaceWith(entry.file)
        }
        return file.write(Buffer.alloc(0))
      })
    } else if (entry.kind === 'symlink') {
      writeDirs.add(path.dirname(targetPath))
      writeOps.push(async () => fs.promises.symlink(entry.target, targetPath))
    } else if (entry.kind === 'empty-dir') {
      writeDirs.add(targetPath)
    }
  }

  // we write the target dir even if the volume is empty
  if (!writeDirs.size) writeDirs.add(targetDirPath)

  // ensure directories exist
  await Promise.all(Array.from(writeDirs).map((dir) => fs.promises.mkdir(dir, { recursive: true })))

  // run file/symlink writes with concurrency limit
  const limit = pLimit(concurrency)
  await Promise.all(writeOps.map((op) => limit(op)))
}

/**
 * Type of a memfs volume path, used by {@link scanVolumePaths}.
 * @internal
 */
export type VolumePathType = 'file' | 'dir' | 'symlink' | 'other'

/**
 * Tuple of an absolute path and {@link VolumePathType} used by {@link scanVolumePaths}.
 * @internal
 */
export type VolumePathEntry = [path: string, type: VolumePathType]

/**
 * Walk a volume breadth-first and return a flat list of `[path, type]` tuples
 * that summarize its structure without loading file data.
 * @internal
 */
export function scanVolumePaths(volume: Volume): VolumePathEntry[] {
  const entries: VolumePathEntry[] = []
  const stack = ['/']
  const visited = new Set<string>()

  while (stack.length > 0) {
    const currPath = stack.pop()!
    if (visited.has(currPath)) continue
    visited.add(currPath)

    const stats = volume.lstatSync(currPath)
    if (currPath !== '/') {
      entries.push([
        currPath,
        stats.isFile()
          ? 'file'
          : stats.isDirectory()
            ? 'dir'
            : stats.isSymbolicLink()
              ? 'symlink'
              : 'other',
      ])
    }

    if (stats.isDirectory()) {
      const children = volume.readdirSync(currPath) as string[]
      for (const child of children) {
        stack.push(path.posix.join(currPath, child))
      }
    }
  }

  return entries
}

/**
 * Build a predicate that reports whether a path should be skipped based on
 * absolute or prefix-relative patterns (supporting glob syntax).
 *
 * **Note**: Negated globs are not supported.
 */
function createIgnoreMatcher(ignore: string | string[] | undefined, prefix: string) {
  if (!ignore || !ignore.length) return () => false
  const patterns = Array.isArray(ignore) ? ignore : [ignore]
  const exact = new Set<string>()
  const regexes: RegExp[] = []

  for (const pattern of patterns) {
    const resolved = resolveAbsPath(pattern, prefix)
    if (isGlobLike(pattern)) {
      regexes.push(toRegex(resolved))
    } else {
      exact.add(resolved)
    }
  }

  return (value: string) => exact.has(value) || regexes.some((regex) => regex.test(value))
}

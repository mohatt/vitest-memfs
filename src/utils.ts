import { vi, ExpectStatic } from 'vitest'
import type { Volume } from 'memfs'
import path from 'path'
import { isText } from 'istextorbinary'
import { toSnapshotSync, SnapshotNode } from 'memfs/lib/snapshot'

// Posix specific pathing for memfs operations
const pathPosix = path.posix

/**
 * Get a filename -> Buffer map from current volume.
 */
export function volumeToMap(volume: Volume, targetDirPath = '/') {
  const snapshot = toSnapshotSync({ fs: volume, path: targetDirPath })
  const result: Record<string, Buffer> = {}

  function walk(node: SnapshotNode, curr: string) {
    if (!node) return

    const [type, _meta, third] = node
    // Handle SnapshotNodeType.Folder
    if (type === 0) {
      for (const [name, child] of Object.entries(third)) {
        walk(child, pathPosix.join(curr, name))
      }
      // Handle SnapshotNodeType.File
    } else if (type === 1) {
      result[curr] = Buffer.from(third)
      // Handle SnapshotNodeType.Symlink
    } else if (type === 2) {
      // optional: handle symlinks if needed
    }
  }

  walk(snapshot, targetDirPath)
  return result
}

export interface VolumeCompareResult {
  pass: boolean
  message: () => string
  actual?: unknown
  expected?: unknown
}

export type VolumeCompareListMatch = 'exact' | 'ignore-extra' | 'ignore-missing'

export interface VolumeCompareOptions {
  negated?: boolean
  listMatch?: VolumeCompareListMatch
}

/**
 * Compare two volume maps.
 *
 * @param received map from volume under test
 * @param expected map from reference (snapshot or other volume)
 * @param options extra options
 */
export function compareVolumeMaps(
  received: Record<string, Buffer>,
  expected: Record<string, Buffer>,
  options?: VolumeCompareOptions,
): VolumeCompareResult {
  const { negated, listMatch } = options ?? {}

  // make sorted arrays for error reporting and better diffing
  const actualFiles = Object.keys(received).sort()
  const expectedFiles = Object.keys(expected).sort()

  // check for file list match
  let listMatchResult: boolean
  let listMatchError: string
  switch (listMatch) {
    case 'ignore-extra':
      listMatchResult = expectedFiles.every((f) => f in received)
      listMatchError = 'volume is missing expected files'
      break

    case 'ignore-missing':
      listMatchResult = actualFiles.every((f) => f in expected)
      listMatchError = 'volume has unexpected extra files'
      break

    case 'exact':
    default:
      listMatchError = 'directory structure didn’t match'
      listMatchResult =
        actualFiles.length === expectedFiles.length &&
        actualFiles.every((f, i) => f === expectedFiles[i])
  }

  if (!listMatchResult) {
    return {
      pass: !!negated,
      message: () => listMatchError,
      actual: actualFiles,
      expected: expectedFiles,
    }
  }

  // compare contents
  const filesToCheck = listMatch === 'ignore-missing' ? actualFiles : expectedFiles
  for (const file of filesToCheck) {
    const exp = expected[file]
    const act = received[file]
    const encoding = isText(file, exp) ? 'utf8' : 'base64'
    const expStr = exp.toString(encoding)
    const actStr = act.toString(encoding)

    const same = expStr === actStr
    if (!same) {
      return {
        pass: false,
        message: () => `${encoding === 'base64' ? 'binary ' : ''}mismatch in file \`${file}\``,
        actual: actStr,
        expected: expStr,
      }
    }
  }

  // everything is matched at this point
  return {
    pass: true,
    message: () => 'volumes matched',
  }
}

export interface WriteVolumeToDirOptions {
  prefix?: string
  clear?: boolean
}

export async function writeVolumeToDir(
  volume: Volume,
  targetDirPath: string,
  options?: WriteVolumeToDirOptions,
) {
  const fsp = await getActualFS()
  const { prefix, clear } = options ?? {}
  const realPrefix = (prefix ? pathPosix.resolve('/', prefix) : '') + '/'
  const map = volumeToMap(volume, realPrefix)

  if (clear) {
    await fsp.rm(targetDirPath, { recursive: true, force: true })
  }

  for (const filePath of Object.keys(map)) {
    // strip prefix
    let rel = filePath.slice(realPrefix.length)
    if (!rel) continue // skip if it’s exactly the prefix (highly unlikely)

    const abs = path.join(targetDirPath, rel)
    await fsp.mkdir(path.dirname(abs), { recursive: true })
    await fsp.writeFile(abs, map[filePath])
  }
}

export async function readDirToMap(targetDirPath: string, prefix?: string) {
  const fsp = await getActualFS()
  const result: Record<string, Buffer> = {}

  async function walk(subDir: string) {
    const entries = await fsp.readdir(subDir, { withFileTypes: true })
    for (const e of entries) {
      const abs = path.join(subDir, e.name)
      if (e.isDirectory()) {
        await walk(abs)
      } else if (e.isFile()) {
        const rel = pathPosix.relative(targetDirPath, abs)
        // apply prefix
        result[pathPosix.join('/', prefix ?? '', rel)] = await fsp.readFile(abs)
      }
    }
  }

  await walk(targetDirPath)
  return result
}

export async function getActualFS() {
  return vi.importActual<typeof import('fs/promises')>('fs/promises')
}

type MatchersObject = Parameters<ExpectStatic['extend']>[0]

/**
 * Creates and returns a matcher function.
 * We could wrap the matcher function in the future to warn on un-awaited promises.
 */
export function createMatcher<T extends keyof MatchersObject>(matcher: T, fn: MatchersObject[T]) {
  Object.defineProperty(fn, 'name', { value: matcher })
  return fn
}

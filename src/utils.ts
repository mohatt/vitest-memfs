import path from 'node:path'
import { createHash } from 'node:crypto'
import { vi } from 'vitest'
import type { MatchersObject } from '@vitest/expect'
import type { Volume } from 'memfs'
import { isText } from 'istextorbinary'
import { toSnapshotSync, SnapshotNode } from 'memfs/lib/snapshot'

// Posix specific pathing for memfs operations
const pathPosix = path.posix

export type VolumeMapEntry =
  | { type: 'file'; data: Buffer }
  | { type: 'dir' }
  | { type: 'symlink'; target: string }

export interface VolumeMap {
  [path: string]: VolumeMapEntry
}

/**
 * Get a filename -> Buffer map from current volume.
 */
export function volumeToMap(volume: Volume, targetDirPath = '/') {
  const snapshot = toSnapshotSync({ fs: volume, path: targetDirPath, separator: '/' })
  const map: VolumeMap = Object.create(null)

  function walk(node: SnapshotNode, curr: string) {
    if (!node) return
    const [type, meta, third] = node

    if (type === 0) {
      // folder
      const children = Object.keys(third)
      if (children.length === 0) {
        map[curr] = { type: 'dir' } // empty folder
      }
      for (const name of children) {
        walk(third[name], pathPosix.join(curr, name))
      }
    } else if (type === 1) {
      map[curr] = { type: 'file', data: Buffer.from(third) }
    } else if (type === 2) {
      map[curr] = { type: 'symlink', target: meta.target }
    }
  }

  walk(snapshot, targetDirPath)
  return map
}

export interface VolumeCompareResult {
  pass: boolean
  message: () => string
  actual?: unknown
  expected?: unknown
}

export type VolumeCompareListMatch = 'exact' | 'ignore-extra' | 'ignore-missing'

export interface VolumeCompareOptions {
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
  received: VolumeMap,
  expected: VolumeMap,
  options?: VolumeCompareOptions,
): VolumeCompareResult {
  const { listMatch } = options ?? {}

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
      pass: false,
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
    if (exp.type !== act.type) {
      return {
        pass: false,
        message: () => `path type mismatch at \`${file}\``,
        actual: act.type,
        expected: exp.type,
      }
    }
    if (exp.type === 'file') {
      if (isText(file, exp.data)) {
        // textual data
        const expStr = exp.data.toString('utf8')
        const actStr = (act as typeof exp).data.toString('utf8')

        if (expStr !== actStr) {
          return {
            pass: false,
            message: () => `mismatch in file \`${file}\``,
            actual: actStr,
            expected: expStr,
          }
        }
      } else {
        // binary files
        const expBuff = exp.data
        const actBuff = (act as typeof exp).data

        if (!expBuff.equals(actBuff)) {
          return {
            pass: false,
            message: () => `binary mismatch in file \`${file}\``,
            actual: makeBinaryPreview(actBuff),
            expected: makeBinaryPreview(expBuff),
          }
        }
      }
    } else if (exp.type === 'symlink') {
      // symlink targets
      const expTarget = exp.target
      const actTarget = (act as typeof exp).target

      if (expTarget !== actTarget) {
        return {
          pass: false,
          message: () => `symlink target mismatch at \`${file}\``,
          actual: actTarget,
          expected: expTarget,
        }
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

  for (const [filePath, entry] of Object.entries(map)) {
    // strip prefix
    const rel = filePath.slice(realPrefix.length)
    if (!rel) continue // skip if it’s exactly the prefix (highly unlikely)

    const abs = path.join(targetDirPath, rel)

    if (entry.type === 'file') {
      await fsp.mkdir(path.dirname(abs), { recursive: true })
      await fsp.writeFile(abs, entry.data)
    } else if (entry.type === 'dir') {
      await fsp.mkdir(abs, { recursive: true })
    } else if (entry.type === 'symlink') {
      await fsp.mkdir(path.dirname(abs), { recursive: true })
      await fsp.symlink(entry.target, abs)
    }
  }
}

export async function readDirToMap(targetDirPath: string, prefix?: string) {
  const fsp = await getActualFS()
  const map: VolumeMap = Object.create(null)

  async function walk(subDir: string) {
    const entries = await fsp.readdir(subDir, { withFileTypes: true })
    if (entries.length === 0) {
      const rel = pathPosix.relative(targetDirPath, subDir)
      map[pathPosix.join('/', prefix ?? '', rel)] = { type: 'dir' }
    }
    for (const e of entries) {
      const abs = path.join(subDir, e.name)
      const rel = pathPosix.relative(targetDirPath, abs)
      const key = pathPosix.join('/', prefix ?? '', rel)

      if (e.isDirectory()) {
        await walk(abs)
      } else if (e.isFile()) {
        map[key] = { type: 'file', data: await fsp.readFile(abs) }
      } else if (e.isSymbolicLink()) {
        map[key] = { type: 'symlink', target: await fsp.readlink(abs) }
      }
    }
  }

  await walk(targetDirPath)
  return map
}

function makeBinaryPreview(buf: Buffer, trim = 32): object {
  const hash = createHash('sha1').update(buf).digest('hex')
  const head = buf.subarray(0, trim).toString('base64')
  const tail = buf.subarray(buf.length - trim).toString('base64')
  return new (class Binary {
    size = buf.length
    sha1 = hash
    preview = `${head}...${tail}`
  })()
}

export async function getActualFS() {
  return vi.importActual<typeof import('fs/promises')>('fs/promises')
}

/**
 * Creates and returns a matcher function.
 * We could wrap the matcher function in the future to warn on un-awaited promises.
 */
export function createMatcher<T extends keyof MatchersObject>(matcher: T, fn: MatchersObject[T]) {
  Object.defineProperty(fn, 'name', { value: matcher })
  return fn
}

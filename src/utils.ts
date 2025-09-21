import path from 'node:path'
import { createHash } from 'node:crypto'
import { vi, expect } from 'vitest'
import type { Volume } from 'memfs'
import { isText } from 'istextorbinary'

// Posix specific pathing for memfs operations
const pathPosix = path.posix

export type VolumeMapEntry =
  | { type: 'file'; data: Buffer }
  | { type: 'symlink'; target: string }
  | { type: 'empty-dir' }

export interface VolumeMap {
  [path: string]: VolumeMapEntry
}

/**
 * Get a filename -> Buffer map from current volume.
 */
export function volumeToMap(volume: Volume, targetDirPath = '/') {
  const map: VolumeMap = Object.create(null)

  function walk(curr: string) {
    const stats = volume.lstatSync(curr)
    if (stats.isDirectory()) {
      const list = volume.readdirSync(curr) as string[]
      if (list.length === 0) map[curr] = { type: 'empty-dir' }
      for (const name of list) {
        walk(path.posix.join(curr, name))
      }
    } else if (stats.isFile()) {
      map[curr] = { type: 'file', data: volume.readFileSync(curr) as Buffer }
    } else if (stats.isSymbolicLink()) {
      map[curr] = { type: 'symlink', target: volume.readlinkSync(curr) as string }
    }
  }

  walk(targetDirPath)
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

  let listMismatchResult: {
    reason: string
    actual: string[]
    expected: string[]
  } | null = null

  switch (listMatch) {
    case 'ignore-extra': {
      const missing = expectedFiles.filter((f) => !(f in received))
      if (missing.length > 0) {
        listMismatchResult = {
          reason: `volume is missing ${missing.length} expected file(s)`,
          actual: actualFiles.filter((f) => f in expected),
          expected: expectedFiles,
        }
      }
      break
    }

    case 'ignore-missing': {
      const extra = actualFiles.filter((f) => !(f in expected))
      if (extra.length > 0) {
        listMismatchResult = {
          reason: `volume has ${extra.length} unexpected file(s)`,
          actual: actualFiles,
          expected: expectedFiles.filter((f) => f in received),
        }
      }
      break
    }

    case 'exact':
    default: {
      if (
        actualFiles.length !== expectedFiles.length ||
        !actualFiles.every((f, i) => f === expectedFiles[i])
      ) {
        listMismatchResult = {
          reason: 'directory structure didn’t match',
          actual: actualFiles,
          expected: expectedFiles,
        }
      }
    }
  }

  if (listMismatchResult) {
    return {
      pass: false,
      message: () => listMismatchResult.reason,
      actual: listMismatchResult.actual,
      expected: listMismatchResult.expected,
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
            actual: makeBufferPreview(actBuff),
            expected: makeBufferPreview(expBuff),
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

  for (const [abs, entry] of Object.entries(map)) {
    // strip prefix
    const rel = abs.slice(realPrefix.length)
    const targetPath = path.join(targetDirPath, rel)

    if (entry.type === 'file') {
      await fsp.mkdir(path.dirname(targetPath), { recursive: true })
      await fsp.writeFile(targetPath, entry.data)
    } else if (entry.type === 'empty-dir') {
      await fsp.mkdir(targetPath, { recursive: true })
    } else if (entry.type === 'symlink') {
      await fsp.mkdir(path.dirname(targetPath), { recursive: true })
      await fsp.symlink(entry.target, targetPath)
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
      map[pathPosix.join('/', prefix ?? '', rel)] = { type: 'empty-dir' }
    }
    for (const entry of entries) {
      const abs = path.join(subDir, entry.name)
      const rel = pathPosix.relative(targetDirPath, abs)
      const key = pathPosix.join('/', prefix ?? '', rel)

      if (entry.isDirectory()) {
        await walk(abs)
      } else if (entry.isFile()) {
        map[key] = { type: 'file', data: await fsp.readFile(abs) }
      } else if (entry.isSymbolicLink()) {
        map[key] = { type: 'symlink', target: await fsp.readlink(abs) }
      }
    }
  }

  await walk(targetDirPath)
  return map
}

function makeBufferPreview(buf: Buffer, trim = 32): object {
  const hash = createHash('sha1').update(buf).digest('hex')
  const head = buf.subarray(0, trim).toString('base64')
  const tail = buf.subarray(buf.length - trim).toString('base64')
  return new (class Buffer {
    length = buf.length
    sha1 = hash
    preview = `${head}...${tail}`
  })()
}

export async function getActualFS() {
  return vi.importActual<typeof import('fs/promises')>('fs/promises')
}

type MatchersObject = Parameters<(typeof expect)['extend']>[0]

/**
 * Creates and returns a matcher function.
 * We could wrap the matcher function in the future to warn on un-awaited promises.
 */
export function createMatcher<T extends keyof MatchersObject>(matcher: T, fn: MatchersObject[T]) {
  Object.defineProperty(fn, 'name', { value: matcher })
  return fn
}

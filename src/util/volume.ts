import path from 'node:path'
import pLimit from 'p-limit'
import type { Volume } from 'memfs'
import { importActualFS } from './common.js'

export type VolumeEntry =
  | { kind: 'file'; data: Buffer }
  | { kind: 'symlink'; target: string }
  | { kind: 'empty-dir' }

export interface VolumeMap {
  [path: string]: VolumeEntry
}

interface VolumeToMapOptions {
  prefix?: string
  withData?: boolean
}

/**
 * Get a filename -> Buffer map from current volume.
 */
export function volumeToMap(volume: Volume, options?: VolumeToMapOptions) {
  const { prefix = '/', withData = true } = options ?? {}
  const map: VolumeMap = Object.create(null)

  function walk(curr: string) {
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
        data: withData ? (volume.readFileSync(curr) as Buffer) : Buffer.alloc(0),
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

export interface ReadDirToMapOptions extends VolumeToMapOptions {
  concurrency?: number
}

export async function readDirToMap(targetDirPath: string, options?: ReadDirToMapOptions) {
  const fsp = await importActualFS()
  const { prefix = '', withData = true, concurrency = 48 } = options ?? {}
  const map: VolumeMap = Object.create(null)

  const limit = pLimit(concurrency)
  const EMPTY_BUFFER = Buffer.alloc(0)

  async function walk(dirPath: string) {
    const entries = await fsp.readdir(dirPath, { withFileTypes: true })
    if (entries.length === 0) {
      const rel = path.posix.relative(targetDirPath, dirPath)
      map[path.posix.join('/', prefix, rel)] = { kind: 'empty-dir' }
    }

    await Promise.all(
      entries.map(async (entry) => {
        const abs = path.join(dirPath, entry.name)
        const rel = path.posix.relative(targetDirPath, abs)
        const key = path.posix.join('/', prefix, rel)

        if (entry.isDirectory()) {
          await walk(abs)
        } else if (entry.isFile()) {
          map[key] = {
            kind: 'file',
            data: withData ? await limit(() => fsp.readFile(abs)) : EMPTY_BUFFER,
          }
        } else if (entry.isSymbolicLink()) {
          map[key] = {
            kind: 'symlink',
            target: await limit(() => fsp.readlink(abs)),
          }
        }
      }),
    )
  }

  await walk(targetDirPath)
  return map
}

export interface WriteVolumeToDirOptions extends VolumeToMapOptions {
  clear?: boolean
  concurrency?: number
}

export async function writeVolumeToDir(
  volume: Volume,
  targetDirPath: string,
  options?: WriteVolumeToDirOptions,
) {
  const fsp = await importActualFS()
  const { prefix, clear, withData = true, concurrency = 48 } = options ?? {}
  const realPrefix = (prefix ? path.posix.resolve('/', prefix) : '') + '/'
  const map = volumeToMap(volume, { prefix: realPrefix })

  if (clear) {
    await fsp.rm(targetDirPath, { recursive: true, force: true })
  }

  const writeDirs = new Set<string>()
  const writeOps: Array<() => Promise<void>> = []

  for (const abs in map) {
    // strip prefix
    const rel = abs.slice(realPrefix.length)
    const targetPath = path.join(targetDirPath, rel)
    const entry = map[abs]

    if (entry.kind === 'file') {
      writeDirs.add(path.dirname(targetPath))
      writeOps.push(() => fsp.writeFile(targetPath, withData ? entry.data : Buffer.alloc(0)))
    } else if (entry.kind === 'symlink') {
      writeDirs.add(path.dirname(targetPath))
      writeOps.push(async () => fsp.symlink(entry.target, targetPath))
    } else if (entry.kind === 'empty-dir') {
      writeDirs.add(targetPath)
    }
  }

  // ensure directories exist
  await Promise.all(Array.from(writeDirs).map((dir) => fsp.mkdir(dir, { recursive: true })))

  // run file/symlink writes with concurrency limit
  const limit = pLimit(concurrency)
  await Promise.all(writeOps.map((op) => limit(op)))
}

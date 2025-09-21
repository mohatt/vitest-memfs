import path from 'node:path'
import type { Volume } from 'memfs'
import { getActualFS } from './common.js'

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

export async function readDirToMap(targetDirPath: string, prefix?: string) {
  const fsp = await getActualFS()
  const map: VolumeMap = Object.create(null)

  async function walk(subDir: string) {
    const entries = await fsp.readdir(subDir, { withFileTypes: true })
    if (entries.length === 0) {
      const rel = path.posix.relative(targetDirPath, subDir)
      map[path.posix.join('/', prefix ?? '', rel)] = { type: 'empty-dir' }
    }
    for (const entry of entries) {
      const abs = path.join(subDir, entry.name)
      const rel = path.posix.relative(targetDirPath, abs)
      const key = path.posix.join('/', prefix ?? '', rel)

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
  const realPrefix = (prefix ? path.posix.resolve('/', prefix) : '') + '/'
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

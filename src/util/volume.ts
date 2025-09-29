import path from 'node:path'
import pLimit from 'p-limit'
import type { Volume } from 'memfs'
import { importActualFS } from './common.js'
import { FileHandle } from './file-handle.js'

export type VolumeEntry =
  | { kind: 'file'; file: FileHandle }
  | { kind: 'symlink'; target: string }
  | { kind: 'empty-dir' }

export interface VolumeMap {
  [path: string]: VolumeEntry
}

interface VolumeToMapOptions {
  prefix?: string
}

/**
 * Get a filename -> Buffer map from current volume.
 */
export function volumeToMap(volume: Volume, options?: VolumeToMapOptions) {
  const { prefix = '/' } = options ?? {}
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

export interface ReadDirToMapOptions extends VolumeToMapOptions {
  concurrency?: number
}

export async function readDirToMap(targetDirPath: string, options?: ReadDirToMapOptions) {
  const fs = await importActualFS()
  const { prefix = '/', concurrency = 48 } = options ?? {}
  const map: VolumeMap = Object.create(null)

  const limit = pLimit(concurrency)

  async function walk(dirPath: string) {
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true })
    if (entries.length === 0) {
      const key = normalizeRelative(targetDirPath, dirPath, prefix)
      map[key] = { kind: 'empty-dir' }
    }

    await Promise.all(
      entries.map(async (entry) => {
        const abs = path.join(dirPath, entry.name)
        const key = normalizeRelative(targetDirPath, abs, prefix)

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
            target: await limit(() => fs.promises.readlink(abs)),
          }
        }
      }),
    )
  }

  await walk(targetDirPath)
  return map
}

function normalizeRelative(from: string, to: string, prefix = '/'): string {
  const rel = path.relative(from, to)
  const relPosix = path.sep === '/' ? rel : rel.split(path.sep).join('/')
  return path.posix.join(prefix, relPosix)
}

export interface WriteVolumeToDirOptions extends VolumeToMapOptions {
  clear?: boolean
  withData?: boolean
  concurrency?: number
}

export async function writeVolumeToDir(
  volume: Volume,
  targetDirPath: string,
  options?: WriteVolumeToDirOptions,
) {
  const fs = await importActualFS()
  const { prefix = '/', clear, withData = true, concurrency = 32 } = options ?? {}
  const map = volumeToMap(volume, { prefix })

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

  // ensure directories exist
  await Promise.all(Array.from(writeDirs).map((dir) => fs.promises.mkdir(dir, { recursive: true })))

  // run file/symlink writes with concurrency limit
  const limit = pLimit(concurrency)
  await Promise.all(writeOps.map((op) => limit(op)))
}

export type VolumePathType = 'file' | 'dir' | 'symlink' | 'other'

export type VolumePathEntry = [path: string, type: VolumePathType]

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

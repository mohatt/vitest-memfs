import path from 'path'
import { DirectoryJSON, Volume } from 'memfs'
import { SnapshotNode, toSnapshotSync } from 'memfs/lib/snapshot'

export type VolumeInput = DirectoryJSON | (() => Volume)

export function makeVol(input: VolumeInput = {}) {
  return typeof input === 'function' ? input() : Volume.fromJSON(input)
}

export function makeTests<T>(tests: (T & { skip?: boolean; only?: boolean })[]) {
  return {
    all: tests,
    get normal() {
      return tests.filter(({ only, skip }) => !skip && !only)
    },
    get only() {
      return tests.filter(({ only }) => only)
    },
    get skip() {
      return tests.filter(({ skip }) => skip)
    },
  }
}

export async function pathToMap(dirPath: string) {
  const rootNode = toSnapshotSync({
    fs: require('fs'),
    path: dirPath,
    separator: path.sep,
  })
  const map: Record<string, [string, string] | null> = Object.create(null)

  function walk(node: SnapshotNode, curr: string) {
    if (!node) return
    const key = path.posix.resolve('/', curr.slice(dirPath.length))
    const [type, meta, third] = node

    if (type === 0) {
      const children = Object.keys(third)
      if (children.length === 0) {
        map[key] = null // empty folder
      }
      for (const name of children) {
        walk(third[name], path.join(curr, name))
      }
    } else if (type === 1) {
      map[key] = ['file', Buffer.from(third).toString('base64')]
    } else if (type === 2) {
      map[key] = ['symlink', meta.target]
    }
  }

  walk(rootNode, dirPath)
  return map
}

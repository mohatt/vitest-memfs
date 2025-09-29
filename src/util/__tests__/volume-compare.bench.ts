import { describe, bench } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { Volume } from 'memfs'
import { readDirToMap, volumeToMap } from '../volume.js'
import { VolumeCompare, type VolumeCompareOptions } from '../volume-compare.js'
import type { VolumeMap } from '../volume.js'

interface Scenario {
  name: string
  factory: (
    size: number,
    mismatch: Mismatch,
  ) => Promise<{ received: VolumeMap; expected: VolumeMap; cleanup?: () => void }>
  only?: boolean
}

interface Size {
  name: string
  size: number
  only?: boolean
}

interface Run {
  name: string
  options: VolumeCompareOptions
  only?: boolean
}

interface Mismatch {
  name: string
  type: 'none' | 'path' | 'content'
  only?: boolean
}

const runs: Run[] = [
  { name: 'sync-first', options: { async: false, report: 'first' } },
  { name: 'sync-all', options: { async: false, report: 'all' } },
  { name: 'async-first', options: { async: true, report: 'first', concurrency: 32 } },
  { name: 'async-all', options: { async: true, report: 'all', concurrency: 32 } },
]

const scenarios: Scenario[] = [
  {
    name: 'volume → volume',
    factory: (size, mismatch) => buildVolumeScenario(size, mismatch),
  },
  {
    name: 'fs → volume',
    factory: (size, mismatch) => buildFsScenario(size, mismatch),
  },
]

const sizes: Size[] = [
  { name: '128 files', size: 128 },
  { name: '28 files', size: 28 },
]

const mismatches: Mismatch[] = [
  { name: 'match', type: 'none' },
  { name: 'path-mismatch', type: 'path' },
  { name: 'content-mismatch', type: 'content' },
]

const activeScenarios = scenarios.some((scenario) => scenario.only)
  ? scenarios.filter((scenario) => scenario.only)
  : scenarios

const activeSizes = sizes.some((size) => size.only) ? sizes.filter((size) => size.only) : sizes

const activeRuns = runs.some((run) => run.only) ? runs.filter((run) => run.only) : runs

const activeMismatches = mismatches.some((variant) => variant.only)
  ? mismatches.filter((variant) => variant.only)
  : mismatches

for (const scenario of activeScenarios) {
  describe(scenario.name, () => {
    for (const size of activeSizes) {
      describe(size.name, () => {
        for (const mismatch of activeMismatches) {
          for (const run of activeRuns) {
            bench(`${mismatch.name} | ${run.name}`, async () => {
              const { received, expected, cleanup } = await scenario.factory(size.size, mismatch)
              const cmp = new VolumeCompare(received, expected, run.options)
              try {
                const result = cmp.compare()
                if (run.options.async) {
                  await result
                }
              } finally {
                cleanup?.()
              }
            })
          }
        }
      })
    }
  })
}

async function buildVolumeScenario(size: number, mismatch: Mismatch) {
  const { received, expected } = createEntryPairs(size, mismatch)
  return {
    received: volumeToMap(createVolume(received)),
    expected: volumeToMap(createVolume(expected)),
  }
}

async function buildFsScenario(size: number, mismatch: Mismatch) {
  const { received, expected } = createEntryPairs(size, mismatch)
  const dir = mkTempDir(`volume-compare-${size}-`)
  writeEntriesToDisk(dir, received)
  return {
    received: await readDirToMap(dir),
    expected: volumeToMap(createVolume(expected)),
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  }
}

type Entry = { path: string; data: string | Buffer }
type EntryPair = { received: Entry[]; expected: Entry[] }

function createEntryPairs(size: number, mismatch: Mismatch): EntryPair {
  const received: Entry[] = []
  const expected: Entry[] = []
  const entries = createEntries(size)

  for (const entry of entries) {
    const receivedEntry: Entry = {
      path:
        mismatch.type === 'path' && shouldRename(entry.path)
          ? entry.path.replace(/file-(\d+)/, 'received-$1')
          : entry.path,
      data: entry.data,
    }

    if (mismatch.type === 'content' && shouldMutate(entry.path)) {
      receivedEntry.data = mutatePayload(entry.data)
    }

    received.push(receivedEntry)
    expected.push(entry)
  }

  // add few large files to stress streaming/hash paths
  for (let i = 0; i < 5; i++) {
    const expPath = `/large/file-${i}.bin`
    const expBuffer = makeLargePayload(i, false)

    received.push({
      path:
        mismatch.type === 'path' && i % 2 === 0 ? expPath.replace('file-', 'received-') : expPath,
      data: mismatch.type === 'content' && i < 2 ? makeLargePayload(i, true) : expBuffer,
    })
    expected.push({ path: expPath, data: expBuffer })
  }

  return { received, expected }
}

function createEntries(count: number): Entry[] {
  const entries: Entry[] = []
  for (let i = 0; i < count; i++) {
    const dir = `group-${Math.floor(i / 64)}`
    const ext = i % 3 === 2 ? '.bin' : i % 3 === 1 ? '.json' : '.txt'
    const name = `file-${i}${ext}`
    entries.push({
      path: `/${dir}/${name}`,
      data: makePayload(i, ext),
    })
  }
  return entries
}

function makePayload(index: number, ext: string): string | Buffer {
  if (ext === '.bin') {
    const length = 256 + (index % 256)
    const buffer = Buffer.alloc(length)
    for (let i = 0; i < length; i++) {
      buffer[i] = (index * 31 + i) & 0xff
    }
    return buffer
  }

  const base = `sample-${ext}-${index}`
  return `${base}:${'x'.repeat((index % 17) + 1)}`
}

function makeLargePayload(index: number, variant: boolean): Buffer {
  const size = 3 * 1024 * 1024 + index * 1024
  const buffer = Buffer.alloc(size)
  for (let i = 0; i < size; i++) {
    const base = (index * 97 + i) & 0xff
    buffer[i] = variant ? base ^ 0xff : base
  }
  return buffer
}

function mutatePayload(value: string | Buffer): string | Buffer {
  if (typeof value === 'string') {
    return `${value}-mut`
  }
  const clone = Buffer.from(value)
  clone[0] ^= 0xff
  return clone
}

function shouldMutate(filePath: string): boolean {
  const hash = [...filePath].reduce((acc, ch) => acc + ch.charCodeAt(0), 0)
  return hash % 17 === 0
}

function shouldRename(filePath: string): boolean {
  const hash = [...filePath].reduce((acc, ch) => acc + ch.charCodeAt(0) * 5, 0)
  return hash % 29 === 0
}

function createVolume(entries: Entry[]): Volume {
  const volume = new Volume()
  volume.mkdirSync('/', { recursive: true })
  for (const entry of entries) {
    volume.mkdirSync(path.posix.dirname(entry.path), { recursive: true })
    volume.writeFileSync(entry.path, entry.data)
  }
  return volume
}

function writeEntriesToDisk(root: string, entries: Entry[]) {
  for (const entry of entries) {
    const diskPath = path.join(root, entry.path.slice(1))
    fs.mkdirSync(path.dirname(diskPath), { recursive: true })
    fs.writeFileSync(diskPath, entry.data)
  }
}

function mkTempDir(prefix: string) {
  return fs.mkdtempSync(path.join(tmpdir(), prefix))
}

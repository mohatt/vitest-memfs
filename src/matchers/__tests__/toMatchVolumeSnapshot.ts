import { describe, it, expect, vi } from 'vitest'
import path from 'path'
import fsx from 'fs-extra'
import { makeTests, makeVol, pathToMap, VolumeInput } from '@test/util.js'
import toMatchVolumeSnapshot, { VolumeSnapshotMatcherOptions } from '../toMatchVolumeSnapshot.js'

interface TestCase {
  name: string
  left: VolumeInput
  right?: string
  opts?: VolumeSnapshotMatcherOptions
  update?: 'all' | 'new'
  pass: boolean
}

const newCases = makeTests<TestCase>([
  {
    name: 'empty volume',
    left: {},
    pass: true,
  },
  {
    name: 'empty dir',
    left: { '/empty': null },
    pass: true,
  },
  {
    name: 'invalid volume',
    left: () => 'invalid' as any,
    pass: false,
  },
  {
    name: 'different files',
    left: {
      '/src/index.js': '// hi',
      '/bin.dat': Buffer.from([0xde, 0xad, 0xbe, 0xef]),
      '/.gitignore': '',
    },
    pass: true,
  },
  {
    name: 'prefix option',
    left: { '/src/foo.txt': 'hi', '/bar.txt': 'ignore-me' },
    opts: { prefix: '/src' },
    pass: true,
  },
])

const existingCases = makeTests<TestCase>([
  {
    name: 'empty volume',
    left: {},
    right: 'empty-vol',
    pass: true,
  },
  {
    name: 'empty dir vs missing dir',
    left: { '/empty': null },
    right: 'empty-vol',
    pass: false,
  },
  {
    name: 'empty dir match',
    left: { '/empty': null },
    right: 'empty-dir',
    pass: true,
  },
  {
    name: 'force update',
    left: { '/foo.txt': 'hi' },
    right: 'empty-dir',
    update: 'all',
    pass: true,
  },
  {
    name: 'prefix option',
    left: { '/src/foo.txt': 'hi', '/bar.txt': 'ignore-me' },
    right: 'foo-dir',
    opts: { prefix: '/src' },
    pass: true,
  },
  {
    name: 'prefix option mismatch',
    left: { '/src/foo.txt': 'hiz', '/bar.txt': 'ignore-me' },
    right: 'foo-dir',
    opts: { prefix: '/src' },
    pass: false,
  },
  {
    name: 'ignores extra files',
    left: { '/foo.txt': 'hi', '/bar.txt': 'hey', '/extra.txt': 'extra' },
    right: 'foo-bar',
    pass: true,
    opts: { listMatch: 'ignore-extra' },
  },
  {
    name: 'ignores extra files (mismatch)',
    left: { '/foo.txt': 'hi', '/extra.txt': 'extra' },
    right: 'foo-bar',
    pass: false,
    opts: { listMatch: 'ignore-extra' },
  },
  {
    name: 'ignores missing files',
    left: { '/foo.txt': 'hi' },
    right: 'foo-bar',
    pass: true,
    opts: { listMatch: 'ignore-missing' },
  },
  {
    name: 'ignores missing files (mismatch)',
    left: { '/foo.txt': 'hi', '/extra.txt': 'extra' },
    right: 'foo-bar',
    pass: false,
    opts: { listMatch: 'ignore-missing' },
  },
  {
    name: 'binary mismatch',
    left: { '/data.bin': Buffer.alloc(100_000, 0xbb) },
    right: 'bin-dir',
    pass: false,
  },
])

describe('toMatchVolumeSnapshot()', () => {
  describe('unit', () => {
    const mockState = (updateSnapshot: string) => ({
      currentTestName: expect.getState().currentTestName,
      snapshotState: {
        _updateSnapshot: updateSnapshot,
        snapshotPath: path.join(__dirname, '__snapshots__', 'temp', 'xxx.snap'),
        match: vi.fn(),
      },
      utils: {
        printReceived: (received) => `received(${JSON.stringify(received)})`,
        matcherHint: (matcherName: string) => `hint(${matcherName})`,
      },
    })

    async function runTest({ name, left, right, opts, update }: TestCase, existing = false) {
      const leftVol = makeVol(left)
      const rightVal = right ?? name.toLowerCase().replace(/\W+/g, '-')
      const state = mockState(update ?? 'new')
      const invoke = async () => {
        try {
          const matcher = toMatchVolumeSnapshot.bind(state as any)
          const result = await matcher(leftVol, rightVal, opts)
          return { ...result, message: result.message() }
        } catch (e) {
          return e
        }
      }
      const snapDir = path.join(path.dirname(state.snapshotState.snapshotPath), rightVal)
      await fsx.remove(snapDir)
      if (existing) {
        const fixtureDir = path.join(__dirname, '__fixtures__', rightVal)
        await fsx.copy(fixtureDir, snapDir)
      }
      const result = await invoke()
      expect(result).toMatchSnapshot('result')
      if (!existing || update === 'all') {
        const snapDirMap = await pathToMap(snapDir).catch((e) => `${e.name}: ${e.code}`)
        expect(snapDirMap).toMatchSnapshot('disk-snapshot')
      }
      await fsx.remove(snapDir)
    }

    async function testRunnerNew(testCase: TestCase) {
      await runTest(testCase, false)
    }

    async function testRunnerExisting(testCase: TestCase) {
      await runTest(testCase, true)
    }

    it.each(newCases.normal)('$name [write]', testRunnerNew)
    it.only.each(newCases.only)('$name [write]', testRunnerNew)
    it.skip.each(newCases.skip)('$name [write]', testRunnerNew)

    it.each(existingCases.normal)('$name [existing]', testRunnerExisting)
    it.only.each(existingCases.only)('$name [existing]', testRunnerExisting)
    it.skip.each(existingCases.skip)('$name [existing]', testRunnerExisting)
  })

  describe('integration', () => {
    it('works correctly', async () => {
      const vol = makeVol({
        '/foo.txt': 'hi',
        '/bin/data.bin': Buffer.alloc(100_000, 0xbb),
      })
      await expect(vol).toMatchVolumeSnapshot('test')
    })

    it('throws when used with not', async () => {
      const vol = makeVol({ '/foo.txt': 'hi' })
      await expect(
        () => expect(vol).not.toMatchVolumeSnapshot('test'), //
      ).rejects.toThrow(/cannot be used with "not"/)
    })
  })
})

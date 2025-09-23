import { describe, it, expect, vi, beforeAll, SnapshotUpdateState } from 'vitest'
import path from 'path'
import fsx from 'fs-extra'
import { makeTests, makeVol, pathToMap, VolumeInput } from '@test/util.js'
import toMatchVolumeSnapshot, { VolumeSnapshotMatcherOptions } from '../toMatchVolumeSnapshot.js'

interface TestCase {
  name: string
  left: VolumeInput
  right?: string
  opts?: VolumeSnapshotMatcherOptions
  update?: SnapshotUpdateState
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
    left: () => {
      const v = makeVol({
        '/src/index.js': '// hi',
        '/bin.dat': Buffer.from([0xde, 0xad, 0xbe, 0xef]),
        '/logs': null,
        '/.gitignore': '',
      })
      v.symlinkSync('/src/index.js', '/index-link.js')
      return v
    },
    pass: true,
  },
  {
    name: 'force update',
    left: { '/foo.txt': 'hi' },
    update: 'all',
    pass: true,
  },
  {
    name: 'force no update',
    left: { '/foo.txt': 'hi' },
    update: 'none',
    pass: false,
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
    name: 'invalid volume',
    left: () => 'invalid' as any,
    right: 'empty-vol',
    update: 'all',
    pass: false,
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
    name: 'respects prefix option',
    left: { '/src/foo.txt': 'hi', '/bar.txt': 'ignore-me' },
    right: 'foo-dir',
    opts: { prefix: '/src' },
    pass: true,
  },
  {
    name: 'respects prefix option (mismatch)',
    left: { '/src/foo.txt': 'hiz', '/bar.txt': 'ignore-me' },
    right: 'foo-dir',
    opts: { prefix: '/src' },
    pass: false,
  },
  {
    name: 'respects listMatch=ignore-extra option',
    left: () => {
      const v = makeVol({ '/foo.txt': 'hi', '/bar.txt': 'hey', '/extra.txt': 'extra' })
      v.symlinkSync('/target1.txt', '/link.txt')
      return v
    },
    right: 'foo-bar',
    opts: { listMatch: 'ignore-extra' },
    pass: true,
  },
  {
    name: 'respects listMatch=ignore-extra option (mismatch)',
    left: { '/foo.txt': 'hi', '/extra.txt': 'extra' },
    right: 'foo-bar',
    opts: { listMatch: 'ignore-extra' },
    pass: false,
  },
  {
    name: 'respects listMatch=ignore-missing option',
    left: { '/foo.txt': 'hi' },
    right: 'foo-bar',
    opts: { listMatch: 'ignore-missing' },
    pass: true,
  },
  {
    name: 'respects listMatch=ignore-missing option (mismatch)',
    left: { '/foo.txt': 'hi', '/extra.txt': 'extra' },
    right: 'foo-bar',
    opts: { listMatch: 'ignore-missing' },
    pass: false,
  },
  {
    name: 'binary mismatch',
    left: { '/data.bin': Buffer.alloc(100_000, 0xbb) },
    right: 'bin-dir',
    pass: false,
  },
  {
    name: 'symlink target mismatch',
    left: () => {
      const v = makeVol({ '/foo.txt': 'hi', '/bar.txt': 'hey' })
      v.symlinkSync('/target2.txt', '/link.txt')
      return v
    },
    right: 'foo-bar',
    pass: false,
  },
  {
    name: 'respects report=all option',
    left: { '/foo.txt': 'hi', '/extra.txt': 'extra' },
    right: 'foo-bar',
    opts: { report: 'all' },
    pass: false,
  },
  {
    name: 'respects report=all option (with ignore-extra)',
    left: { '/foo.txt': 'hi', '/extra.txt': 'extra' },
    right: 'foo-bar',
    opts: { listMatch: 'ignore-extra', report: 'all' },
    pass: false,
  },
  {
    name: 'respects report=all option (with ignore-missing)',
    left: { '/foo.txt': 'hi', '/extra.txt': 'extra' },
    right: 'foo-bar',
    opts: { listMatch: 'ignore-missing', report: 'all' },
    pass: false,
  },
  {
    name: 'respects contentMatch=ignore option',
    left: () => {
      const v = makeVol({ '/foo.txt': 'hey', '/bar.txt': 'there' })
      v.symlinkSync('/target2.txt', '/link.txt')
      return v
    },
    right: 'foo-bar',
    opts: { contentMatch: 'ignore' },
    pass: true,
  },
])

describe('toMatchVolumeSnapshot()', () => {
  describe('unit', () => {
    const mockState = (updateSnapshot: SnapshotUpdateState) => ({
      currentTestName: expect.getState().currentTestName,
      snapshotState: {
        _updateSnapshot: updateSnapshot,
        snapshotPath: path.join(__dirname, '__snapshots__', 'temp', 'xxx.snap'),
        added: { increment: vi.fn() },
        updated: { increment: vi.fn() },
        matched: { increment: vi.fn() },
        unmatched: { increment: vi.fn() },
      },
      utils: {
        printReceived: (received) => `received(${JSON.stringify(received)})`,
        matcherHint: (matcherName: string) => `hint(${matcherName})`,
      },
    })

    async function runTest({ name, left, right, opts, pass, update }: TestCase, existing = false) {
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
      expect(result).toHaveProperty('pass', pass)
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

    beforeAll(async () => {
      // make empty dir fixtures since they are not supported in git
      const fixturesRoot = path.join(__dirname, '__fixtures__')
      await fsx.emptyDir(path.join(fixturesRoot, 'empty-vol'))
      await fsx.emptyDir(path.join(fixturesRoot, 'empty-dir', 'empty'))
    })

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
      vol.symlinkSync('/foo.txt', '/bin/foo-link.txt')
      await expect(vol).toMatchVolumeSnapshot('test')
    })

    it('throws when used without snapshot name', async () => {
      const vol = makeVol({ '/foo.txt': 'hi' })
      await expect(
        () => expect(vol).toMatchVolumeSnapshot(null), //
      ).rejects.toThrow(/must provide a snapshot directory name/)
    })

    it('throws when used with not', async () => {
      const vol = makeVol({ '/foo.txt': 'hi' })
      await expect(
        () => expect(vol).not.toMatchVolumeSnapshot('test'), //
      ).rejects.toThrow(/cannot be used with `not`/)
    })
  })
})

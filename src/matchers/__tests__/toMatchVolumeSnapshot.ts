import { describe, it, expect, vi, beforeAll, SnapshotUpdateState } from 'vitest'
import path from 'node:path'
import fsx from 'fs-extra'
import { makeTests, makeVol, pathToMap, VolumeInput } from '@test/util.js'
import toMatchVolumeSnapshot, { VolumeSnapshotMatcherOptions } from '../toMatchVolumeSnapshot.js'

interface TestCase {
  name: string
  received: VolumeInput
  expected?: string
  options?: VolumeSnapshotMatcherOptions
  update?: SnapshotUpdateState
  pass: boolean
}

const newCases = makeTests<TestCase>([
  {
    name: 'empty volume',
    received: {},
    pass: true,
  },
  {
    name: 'empty dir',
    received: { '/empty': null },
    pass: true,
  },
  {
    name: 'invalid volume',
    received: () => 'invalid' as any,
    pass: false,
  },
  {
    name: 'different files',
    received: () => {
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
    received: { '/foo.txt': 'hi' },
    update: 'all',
    pass: true,
  },
  {
    name: 'force no update',
    received: { '/foo.txt': 'hi' },
    update: 'none',
    pass: false,
  },
  {
    name: 'prefix option',
    received: { '/src/foo.txt': 'hi', '/bar.txt': 'ignore-me' },
    options: { prefix: '/src' },
    pass: true,
  },
])

const fixtureCases = makeTests<TestCase>([
  {
    name: 'empty volume',
    received: {},
    expected: 'empty-vol',
    pass: true,
  },
  {
    name: 'invalid volume',
    received: () => 'invalid' as any,
    expected: 'empty-vol',
    update: 'all',
    pass: false,
  },
  {
    name: 'empty dir vs missing dir',
    received: { '/empty': null },
    expected: 'empty-vol',
    pass: false,
  },
  {
    name: 'empty dir match',
    received: { '/empty': null },
    expected: 'empty-dir',
    pass: true,
  },
  {
    name: 'force update',
    received: { '/foo.txt': 'hi' },
    expected: 'empty-dir',
    update: 'all',
    pass: true,
  },
  {
    name: 'respects prefix option',
    received: { '/src/foo.txt': 'hi', '/bar.txt': 'ignore-me' },
    expected: 'foo-dir',
    options: { prefix: '/src' },
    pass: true,
  },
  {
    name: 'respects prefix option (mismatch)',
    received: { '/src/foo.txt': 'hiz', '/bar.txt': 'ignore-me' },
    expected: 'foo-dir',
    options: { prefix: '/src' },
    pass: false,
  },
  {
    name: 'respects listMatch=ignore-extra option',
    received: () => {
      const v = makeVol({ '/foo.txt': 'hi', '/bar.txt': 'hey', '/extra.txt': 'extra' })
      v.symlinkSync('/target1.txt', '/link.txt')
      return v
    },
    expected: 'foo-bar',
    options: { listMatch: 'ignore-extra' },
    pass: true,
  },
  {
    name: 'respects listMatch=ignore-extra option (mismatch)',
    received: { '/foo.txt': 'hi', '/extra.txt': 'extra' },
    expected: 'foo-bar',
    options: { listMatch: 'ignore-extra' },
    pass: false,
  },
  {
    name: 'respects listMatch=ignore-missing option',
    received: { '/foo.txt': 'hi' },
    expected: 'foo-bar',
    options: { listMatch: 'ignore-missing' },
    pass: true,
  },
  {
    name: 'respects listMatch=ignore-missing option (mismatch)',
    received: { '/foo.txt': 'hi', '/extra.txt': 'extra' },
    expected: 'foo-bar',
    options: { listMatch: 'ignore-missing' },
    pass: false,
  },
  {
    name: 'binary mismatch',
    received: { '/data.bin': Buffer.alloc(100_000, 0xbb) },
    expected: 'bin-dir',
    pass: false,
  },
  {
    name: 'symlink target mismatch',
    received: () => {
      const v = makeVol({ '/foo.txt': 'hi', '/bar.txt': 'hey' })
      v.symlinkSync('/target2.txt', '/link.txt')
      return v
    },
    expected: 'foo-bar',
    pass: false,
  },
  {
    name: 'respects report=all option',
    received: { '/foo.txt': 'hi', '/extra.txt': 'extra' },
    expected: 'foo-bar',
    options: { report: 'all' },
    pass: false,
  },
  {
    name: 'respects report=all option (with ignore-extra)',
    received: { '/foo.txt': 'hi', '/extra.txt': 'extra' },
    expected: 'foo-bar',
    options: { listMatch: 'ignore-extra', report: 'all' },
    pass: false,
  },
  {
    name: 'respects report=all option (with ignore-missing)',
    received: { '/foo.txt': 'hi', '/extra.txt': 'extra' },
    expected: 'foo-bar',
    options: { listMatch: 'ignore-missing', report: 'all' },
    pass: false,
  },
  {
    name: 'respects contentMatch=ignore option',
    received: () => {
      const v = makeVol({ '/foo.txt': 'hey', '/bar.txt': 'there' })
      v.symlinkSync('/target2.txt', '/link.txt')
      return v
    },
    expected: 'foo-bar',
    options: { contentMatch: 'ignore' },
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
        printReceived: (received: unknown) => `received(${JSON.stringify(received)})`,
        matcherHint: (matcherName: string) => `hint(${matcherName})`,
      },
    })

    async function runTest(
      { name, received, expected, options, pass, update }: TestCase,
      hasSnapshot = false,
    ) {
      const actVol = makeVol(received)
      const expDir = expected ?? name.toLowerCase().replace(/\W+/g, '-')
      const state = mockState(update ?? 'new')
      const invoke = async () => {
        try {
          const matcher = toMatchVolumeSnapshot.bind(state as any)
          const result = await matcher(actVol, expDir, options)
          return { ...result, message: result.message() }
        } catch (e) {
          return e
        }
      }
      const snapDir = path.join(path.dirname(state.snapshotState.snapshotPath), expDir)
      await fsx.remove(snapDir)
      if (hasSnapshot) {
        const fixtureDir = path.join(__dirname, '__fixtures__', expDir)
        await fsx.copy(fixtureDir, snapDir)
      }
      const result = await invoke()
      expect(result).toHaveProperty('pass', pass)
      expect(result).toMatchSnapshot('result')
      if (!hasSnapshot || update === 'all') {
        const snapDirMap = await pathToMap(snapDir).catch((e) => `${e.name}: ${e.code}`)
        expect(snapDirMap).toMatchSnapshot('disk-snapshot')
      }
      await fsx.remove(snapDir)
    }

    async function testRunnerNew(testCase: TestCase) {
      await runTest(testCase, false)
    }

    async function testRunnerFixture(testCase: TestCase) {
      await runTest(testCase, true)
    }

    beforeAll(async () => {
      // make empty dir fixtures since they are not supported in git
      const fixturesRoot = path.join(__dirname, '__fixtures__')
      await fsx.emptyDir(path.join(fixturesRoot, 'empty-vol'))
      await fsx.emptyDir(path.join(fixturesRoot, 'empty-dir', 'empty'))
    })

    it.each(newCases.normal)('$name [new]', testRunnerNew)
    it.only.each(newCases.only)('$name [new]', testRunnerNew)
    it.skip.each(newCases.skip)('$name [new]', testRunnerNew)

    it.each(fixtureCases.normal)('$name [fixture]', testRunnerFixture)
    it.only.each(fixtureCases.only)('$name [fixture]', testRunnerFixture)
    it.skip.each(fixtureCases.skip)('$name [fixture]', testRunnerFixture)
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

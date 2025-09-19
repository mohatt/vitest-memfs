import { describe, it, expect } from 'vitest'
import type { MatcherState } from '@vitest/expect'
import { Volume, DirectoryJSON, vol } from 'memfs'
import toMatchVolume, { VolumeMatcherOptions } from '../toMatchVolume'

type VolumeInput = DirectoryJSON | (() => Volume)

interface TestCase {
  name: string
  left: VolumeInput
  right: VolumeInput
  opts?: VolumeMatcherOptions
  pass: boolean
  not?: boolean
  skip?: boolean
  only?: boolean
}

const cases: TestCase[] = [
  {
    name: 'identical files',
    left: { '/foo.txt': 'hi' },
    right: { '/foo.txt': 'hi' },
    pass: true,
  },
  {
    name: 'same ref (singleton vol)',
    left: () => {
      vol.reset()
      vol.fromJSON({ '/foo.txt': 'hi' })
      return vol
    },
    right: () => vol,
    pass: true,
  },
  {
    name: 'content mismatch',
    left: { '/foo.txt': 'hello' },
    right: { '/foo.txt': 'world' },
    pass: false,
  },
  {
    name: 'missing file',
    left: { '/foo.txt': 'hi' },
    right: { '/foo.txt': 'hi', '/bar.txt': 'extra' },
    pass: false,
  },
  {
    name: 'extra file',
    left: { '/foo.txt': 'hi', '/bar.txt': 'extra' },
    right: { '/foo.txt': 'hi' },
    pass: false,
  },
  {
    name: 'respects ignore-extra option',
    left: { '/foo.txt': 'hi', '/bar.txt': 'extra' },
    right: { '/foo.txt': 'hi' },
    pass: true,
    opts: { listMatch: 'ignore-extra' },
  },
  {
    name: 'respects ignore-missing option',
    left: { '/foo.txt': 'hi' },
    right: { '/foo.txt': 'hi', '/bar.txt': 'extra' },
    pass: true,
    opts: { listMatch: 'ignore-missing' },
  },
  {
    name: 'empty directories match',
    left: { '/empty': null },
    right: { '/empty': null },
    pass: true,
  },
  {
    name: 'empty dir vs missing dir',
    left: { '/empty': null },
    right: {},
    pass: false,
  },
  {
    name: 'symlink target mismatch',
    left: () => {
      const v = new Volume()
      v.symlinkSync('/target1.txt', '/link.txt')
      return v
    },
    right: () => {
      const v = new Volume()
      v.symlinkSync('/target2.txt', '/link.txt')
      return v
    },
    pass: false,
  },
  {
    name: 'respects prefix option',
    left: { '/src/foo.txt': 'hi' },
    right: { '/src/foo.txt': 'hi', '/bar.txt': 'extra' },
    pass: true,
    opts: { prefix: '/src' },
  },
  {
    name: 'binary files match',
    left: () => {
      const v = new Volume()
      v.writeFileSync('/bin.dat', Buffer.from([0xde, 0xad, 0xbe, 0xef]))
      return v
    },
    right: () => {
      const v = new Volume()
      v.writeFileSync('/bin.dat', Buffer.from([0xde, 0xad, 0xbe, 0xef]))
      return v
    },
    pass: true,
  },
  {
    name: 'binary files mismatch',
    left: () => {
      const v = new Volume()
      v.writeFileSync('/bin.dat', Buffer.from([0xde, 0xad, 0xbe, 0xef]))
      return v
    },
    right: () => {
      const v = new Volume()
      v.writeFileSync('/bin.dat', Buffer.from([0xca, 0xfe, 0xba, 0xbe]))
      return v
    },
    pass: false,
  },
  {
    name: 'large binary file mismatch',
    left: () => {
      const v = new Volume()
      const buf = Buffer.alloc(100_000, 0xaa) // 100KB of 0xaa
      v.writeFileSync('/big.bin', buf)
      return v
    },
    right: () => {
      const v = new Volume()
      const buf = Buffer.alloc(100_000, 0xaa)
      buf[50_000] = 0xbb // flip a byte in the middle
      v.writeFileSync('/big.bin', buf)
      return v
    },
    pass: false,
  },
  {
    name: 'not: identical files',
    left: { '/foo.txt': 'hi' },
    right: { '/foo.txt': 'hi' },
    pass: false, // it should fail because `.not` negates a match
    not: true,
  },
  {
    name: 'not: content mismatch',
    left: { '/foo.txt': 'hello' },
    right: { '/foo.txt': 'world' },
    pass: true, // should pass because mismatch is expected with `.not`
    not: true,
  },
  {
    name: 'not: extra file',
    left: { '/foo.txt': 'hi', '/bar.txt': 'extra' },
    right: { '/foo.txt': 'hi' },
    pass: true, // passes because with `.not` we want them NOT to match
    not: true,
  },
]

describe('toMatchVolume()', () => {
  const mockState = {
    utils: {
      printReceived: (received) => `received(${JSON.stringify(received)})`,
      matcherHint: (matcherName: string) => `hint(${matcherName})`,
    },
  } as MatcherState

  const makeVol = (input: VolumeInput) =>
    typeof input === 'function' ? input() : Volume.fromJSON(input)

  // invokes the matcher directly to get the return value snapshot
  async function testRunnerUnit({ left, right, opts, not }: TestCase) {
    const leftVol = makeVol(left)
    const rightVol = makeVol(right)
    const invoke = async () => {
      let snap: any
      try {
        const result = await toMatchVolume.call(
          { ...mockState, isNot: not },
          leftVol,
          rightVol,
          opts,
        )
        snap = {
          ...result,
          message: result.message(),
        }
      } catch (e) {
        snap = e
      }
      return snap
    }
    expect(await invoke()).toMatchSnapshot()
  }

  function testRunnerInteg({ left, right, pass, opts, not }: TestCase) {
    const leftVol = makeVol(left)
    const rightVol = makeVol(right)

    if (not) {
      if (pass) {
        expect(leftVol).not.toMatchVolume(rightVol, opts)
      } else {
        expect(() =>
          expect(leftVol).not.toMatchVolume(rightVol, opts),
        ).toThrowErrorMatchingSnapshot()
      }
    } else {
      if (pass) {
        expect(leftVol).toMatchVolume(rightVol, opts)
      } else {
        expect(() => expect(leftVol).toMatchVolume(rightVol, opts)).toThrowErrorMatchingSnapshot()
      }
    }
  }

  // only > skip > normal
  const onlyCases = cases.filter(({ only }) => only)
  const skipCases = cases.filter(({ skip }) => skip)
  const normalCases = cases.filter(({ only, skip }) => !skip && !only)

  describe('unit', () => {
    it.each(normalCases)('$name', testRunnerUnit)
    it.only.each(onlyCases)('$name', testRunnerUnit)
    it.skip.each(skipCases)('$name', testRunnerUnit)
  })

  describe('integration', () => {
    it.each(normalCases)('$name', testRunnerInteg)
    it.only.each(onlyCases)('$name', testRunnerInteg)
    it.skip.each(skipCases)('$name', testRunnerInteg)
  })
})

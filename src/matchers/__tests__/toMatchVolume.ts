import { describe, it, expect } from 'vitest'
import { vol } from 'memfs'
import { makeTests, makeVol, VolumeInput } from '@test/util.js'
import toMatchVolume, { VolumeMatcherOptions } from '../toMatchVolume.js'

interface TestCase {
  name: string
  received: VolumeInput
  expected: VolumeInput
  options?: VolumeMatcherOptions
  pass?: boolean
  not?: boolean
}

const cases = makeTests<TestCase>([
  {
    name: 'identical files',
    received: { '/foo.txt': 'hi' },
    expected: { '/foo.txt': 'hi' },
    pass: true,
  },
  {
    name: 'same ref (singleton vol)',
    received: () => {
      vol.reset()
      vol.fromJSON({ '/foo.txt': 'hi' })
      return vol
    },
    expected: () => vol,
    pass: true,
  },
  {
    name: 'content mismatch',
    received: { '/foo.txt': 'hello' },
    expected: { '/foo.txt': 'world' },
    pass: false,
  },
  {
    name: 'accepts json input',
    received: { '/foo.txt': 'hi' },
    expected: () => ({ '/foo.txt': 'hi' }) as any,
    pass: true,
  },
  {
    name: 'invalid type (received)',
    received: () => 'invalid' as any,
    expected: () => vol,
  },
  {
    name: 'invalid type (expected)',
    received: () => vol,
    expected: () => 'invalid' as any,
  },
  {
    name: 'invalid object type (expected)',
    received: () => vol,
    expected: () => new Date() as any,
  },
  {
    name: 'missing file',
    received: { '/foo.txt': 'hi' },
    expected: { '/foo.txt': 'hi', '/bar.txt': 'extra' },
    pass: false,
  },
  {
    name: 'extra file',
    received: { '/foo.txt': 'hi', '/bar.txt': 'extra' },
    expected: { '/foo.txt': 'hi' },
    pass: false,
  },
  {
    name: 'respects listMatch=ignore-extra option',
    received: { '/foo.txt': 'hi', '/bar.txt': 'hey', '/extra.txt': 'extra' },
    expected: { '/foo.txt': 'hi', '/bar.txt': 'hey' },
    pass: true,
    options: { listMatch: 'ignore-extra' },
  },
  {
    name: 'respects listMatch=ignore-extra option (mismatch)',
    received: { '/foo.txt': 'hi', '/extra.txt': 'extra' },
    expected: { '/foo.txt': 'hi', '/bar.txt': 'hey' },
    pass: false,
    options: { listMatch: 'ignore-extra' },
  },
  {
    name: 'respects listMatch=ignore-missing option',
    received: { '/foo.txt': 'hi' },
    expected: { '/foo.txt': 'hi', '/bar.txt': 'hey' },
    options: { listMatch: 'ignore-missing' },
    pass: true,
  },
  {
    name: 'respects listMatch=ignore-missing option (mismatch)',
    received: { '/foo.txt': 'hi', '/extra.txt': 'extra' },
    expected: { '/foo.txt': 'hi', '/bar.txt': 'hey' },
    options: { listMatch: 'ignore-missing' },
    pass: false,
  },
  {
    name: 'respects contentMatch=ignore option',
    received: () => {
      const v = makeVol({ '/foo.txt': 'hi' })
      v.symlinkSync('/target1.txt', '/link.txt')
      return v
    },
    expected: () => {
      const v = makeVol({ '/foo.txt': 'hello' })
      v.symlinkSync('/target2.txt', '/link.txt')
      return v
    },
    options: { contentMatch: 'ignore' },
    pass: true,
  },
  {
    name: 'respects contentMatch=ignore option (mismatch)',
    received: () => {
      const v = makeVol({ '/foo.txt': 'hi' })
      v.symlinkSync('/target1.txt', '/link.txt')
      return v
    },
    expected: { '/foo.txt': 'hello', '/link.txt': 'world' },
    options: { contentMatch: 'ignore' },
    pass: false,
  },
  {
    name: 'respects contentMatch=ignore-files option',
    received: () => {
      const v = makeVol({ '/foo.txt': 'hi' })
      v.symlinkSync('/target1.txt', '/link.txt')
      return v
    },
    expected: () => {
      const v = makeVol({ '/foo.txt': 'hello' })
      v.symlinkSync('/target1.txt', '/link.txt')
      return v
    },
    options: { contentMatch: 'ignore-files' },
    pass: true,
  },
  {
    name: 'respects contentMatch=ignore-symlinks option',
    received: () => {
      const v = makeVol({ '/foo.txt': 'hi' })
      v.symlinkSync('/target1.txt', '/link.txt')
      return v
    },
    expected: () => {
      const v = makeVol({ '/foo.txt': 'hi' })
      v.symlinkSync('/target2.txt', '/link.txt')
      return v
    },
    options: { contentMatch: 'ignore-symlinks' },
    pass: true,
  },
  {
    name: 'empty directories match',
    received: { '/empty': null },
    expected: { '/empty': null },
    pass: true,
  },
  {
    name: 'empty dir vs missing dir',
    received: { '/empty': null },
    expected: {},
    pass: false,
  },
  {
    name: 'symlink target mismatch',
    received: () => {
      const v = makeVol()
      v.symlinkSync('/target1.txt', '/link.txt')
      return v
    },
    expected: () => {
      const v = makeVol()
      v.symlinkSync('/target2.txt', '/link.txt')
      return v
    },
    pass: false,
  },
  {
    name: 'respects prefix option',
    received: { '/src/foo.txt': 'hi' },
    expected: { '/src/foo.txt': 'hi', '/bar.txt': 'extra' },
    options: { prefix: '/src' },
    pass: true,
  },
  {
    name: 'respects prefix option (received)',
    received: { '/src/foo.txt': 'hi', '/bar.txt': 'extra' },
    expected: { '/src/foo.txt': 'hi' },
    options: { prefix: '/src' },
    pass: true,
  },
  {
    name: 'binary files match',
    received: () => {
      const v = makeVol()
      v.writeFileSync('/bin.dat', Buffer.from([0xde, 0xad, 0xbe, 0xef]))
      return v
    },
    expected: () => {
      const v = makeVol()
      v.writeFileSync('/bin.dat', Buffer.from([0xde, 0xad, 0xbe, 0xef]))
      return v
    },
    pass: true,
  },
  {
    name: 'binary files mismatch',
    received: () => {
      const v = makeVol()
      v.writeFileSync('/bin.dat', Buffer.from([0xde, 0xad, 0xbe, 0xef]))
      return v
    },
    expected: () => {
      const v = makeVol()
      v.writeFileSync('/bin.dat', Buffer.from([0xca, 0xfe, 0xba, 0xbe]))
      return v
    },
    pass: false,
  },
  {
    name: 'large binary file mismatch',
    received: () => {
      const v = makeVol()
      const buf = Buffer.alloc(100_000, 0xaa) // 100KB of 0xaa
      v.writeFileSync('/big.bin', buf)
      return v
    },
    expected: () => {
      const v = makeVol()
      const buf = Buffer.alloc(100_000, 0xaa)
      buf[50_000] = 0xbb // flip a byte in the middle
      v.writeFileSync('/big.bin', buf)
      return v
    },
    pass: false,
  },
  {
    name: 'not: identical files',
    received: { '/foo.txt': 'hi' },
    expected: { '/foo.txt': 'hi' },
    pass: false, // it should fail because `.not` negates a match
    not: true,
  },
  {
    name: 'not: content mismatch',
    received: { '/foo.txt': 'hello' },
    expected: { '/foo.txt': 'world' },
    pass: true, // should pass because mismatch is expected with `.not`
    not: true,
  },
  {
    name: 'not: extra file',
    received: { '/foo.txt': 'hi', '/bar.txt': 'extra' },
    expected: { '/foo.txt': 'hi' },
    pass: true, // passes because with `.not` we want them NOT to match
    not: true,
  },
])

describe('toMatchVolume()', () => {
  describe('unit', () => {
    const mockState = {
      utils: {
        printReceived: (received: unknown) => `received(${JSON.stringify(received)})`,
        matcherHint: (matcherName: string) => `hint(${matcherName})`,
      },
    }

    // invokes the matcher directly to get the return value snapshot
    function testRunnerUnit({ received, expected, options, pass, not }: TestCase) {
      const actVol = makeVol(received)
      const expVol = makeVol(expected)

      const invoke = (reportAll = false) => {
        try {
          const matcher = toMatchVolume.bind(mockState as any)
          const result = matcher(
            actVol,
            expVol,
            reportAll ? { ...options, report: 'all' } : options,
          ) as any
          return { ...result, message: result.message() }
        } catch (e) {
          return e
        }
      }

      const result = invoke()
      if (pass != null) expect(result).toHaveProperty('pass', not ? !pass : pass)
      expect(result).toMatchSnapshot('result')

      if (pass != null) {
        const resultAll = invoke(true)
        expect(resultAll).toHaveProperty('pass', not ? !pass : pass)
        expect(resultAll).toMatchSnapshot('result-all')
      }
    }

    it.each(cases.normal)('$name', testRunnerUnit)
    it.only.each(cases.only)('$name', testRunnerUnit)
    it.skip.each(cases.skip)('$name', testRunnerUnit)
  })

  describe('integration', () => {
    function testRunnerInteg({ received, expected, pass, options, not }: TestCase) {
      const actVol = makeVol(received)
      const expVol = makeVol(expected)

      if (not) {
        if (pass) {
          expect(actVol).not.toMatchVolume(expVol, options)
        } else {
          expect(() =>
            expect(actVol).not.toMatchVolume(expVol, options),
          ).toThrowErrorMatchingSnapshot()
        }
      } else {
        if (pass) {
          expect(actVol).toMatchVolume(expVol, options)
        } else {
          expect(() => expect(actVol).toMatchVolume(expVol, options)).toThrowErrorMatchingSnapshot()
        }
      }
    }

    it.each(cases.normal)('$name', testRunnerInteg)
    it.only.each(cases.only)('$name', testRunnerInteg)
    it.skip.each(cases.skip)('$name', testRunnerInteg)
  })
})

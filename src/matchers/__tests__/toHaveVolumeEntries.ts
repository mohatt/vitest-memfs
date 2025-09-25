import { describe, it, expect } from 'vitest'
import { makeTests, makeVol, VolumeInput } from '@test/util.js'
import toHaveVolumeEntries, { VolumeEntriesMatcherOptions } from '../toHaveVolumeEntries.js'

interface TestCase {
  name: string
  received: VolumeInput
  expected: any
  options?: VolumeEntriesMatcherOptions
  pass?: boolean
  not?: boolean
  throws?: boolean
}

const cases = makeTests<TestCase>([
  {
    name: 'matches an array of paths',
    received: {
      '/foo.txt': 'hello',
      '/dir': null,
    },
    expected: ['/foo.txt', '/dir'],
    pass: true,
  },
  {
    name: 'matches a single path string',
    received: {
      '/foo.txt': 'hello',
    },
    expected: '/foo.txt',
    pass: true,
  },
  {
    name: 'fails when a path is missing',
    received: {
      '/foo.txt': 'hello',
    },
    expected: ['/foo.txt', '/missing.txt'],
    pass: false,
  },
  {
    name: 'matches entry types from object input',
    received: () => {
      const v = makeVol({
        '/foo.txt': 'hello',
      })
      v.mkdirSync('/dir')
      v.writeFileSync('/dir/nested.txt', 'nested')
      v.symlinkSync('/foo.txt', '/link.txt')
      return v
    },
    expected: {
      '/foo.txt': 'file',
      '/dir': 'dir',
      '/link.txt': 'symlink',
    },
    pass: true,
  },
  {
    name: 'detects type mismatches',
    received: () => {
      const v = makeVol({
        '/foo.txt': 'hello',
      })
      v.mkdirSync('/dir')
      v.writeFileSync('/dir/nested.txt', 'nested')
      return v
    },
    expected: {
      '/foo.txt': 'dir',
      '/dir': 'file',
    },
    pass: false,
  },
  {
    name: 'supports prefix option with relative paths',
    received: {
      '/src/index.ts': 'export {}',
      '/src/utils.ts': 'export const noop = () => {}',
    },
    expected: ['index.ts', 'utils.ts'],
    options: { prefix: '/src' },
    pass: true,
  },
  {
    name: 'matches glob patterns from array strings',
    received: {
      '/src/index.ts': 'export {}',
      '/src/utils/math.ts': 'export const add = () => {}',
      '/src/styles.css': 'body {}',
    },
    expected: ['/src/**/*.ts'],
    pass: true,
  },
  {
    name: 'matches glob patterns from a string value',
    received: {
      '/src/index.ts': 'export {}',
      '/src/utils/math.ts': 'export const add = () => {}',
      '/src/styles.css': 'body {}',
    },
    expected: '/src/**/*.ts',
    pass: true,
  },
  {
    name: 'throws when array includes regular expression',
    received: {
      '/foo.txt': 'hello',
      '/bar.ts': 'export {}',
    },
    expected: [/\.txt$/],
    throws: true,
  },
  {
    name: 'matches typed glob patterns from object config',
    received: () => {
      const v = makeVol({
        '/src/index.ts': 'export {}',
      })
      v.mkdirSync('/src/components')
      v.writeFileSync('/src/components/button.tsx', 'export const Button = () => null')
      return v
    },
    expected: {
      '/src/**/*': { type: 'dir' },
    },
    pass: true,
  },
  {
    name: 'handles non-volume inputs',
    received: () => 'invalid volume' as any,
    expected: ['/foo.txt'],
    pass: false,
  },
  {
    name: 'throws for invalid path array values',
    received: {
      '/foo.txt': 'hello',
    },
    expected: ['/foo.txt', 42],
    throws: true,
  },
  {
    name: 'throws for invalid pattern objects',
    received: {
      '/foo.txt': 'hello',
    },
    expected: [{ path: 123 }],
    throws: true,
  },
  {
    name: 'throws when pattern object uses regex path',
    received: {
      '/foo.txt': 'hello',
    },
    expected: [{ path: /foo/ }],
    throws: true,
  },
  {
    name: 'throws for invalid entry type values',
    received: {
      '/foo.txt': 'hello',
    },
    expected: { '/foo.txt': 'file', '/bar': 'folder' },
    throws: true,
  },
  {
    name: 'fails when glob pattern has no matches',
    received: {
      '/foo.txt': 'hello',
    },
    expected: ['/src/**/*.ts'],
    pass: false,
  },
  {
    name: 'detects type mismatches for glob patterns',
    received: {
      '/foo.txt': 'hello',
      '/bar': null,
    },
    expected: {
      '/**/*.txt': { type: 'dir' },
    },
    pass: false,
  },
  {
    name: 'not: matches an array of paths',
    received: {
      '/foo.txt': 'hello',
    },
    expected: ['/foo.txt'],
    pass: false,
    not: true,
  },
  {
    name: 'not: fails when entries are missing',
    received: {
      '/foo.txt': 'hello',
    },
    expected: ['/missing.txt'],
    pass: true,
    not: true,
  },
])

describe('toHaveVolumeEntries()', () => {
  describe('unit', () => {
    const mockState = (isNot = false): any => ({
      utils: {
        printReceived: (received: unknown) => `received(${JSON.stringify(received)})`,
        printExpected: (expected: unknown) => `expected(${JSON.stringify(expected)})`,
        matcherHint: (matcherName: string) => `hint(${matcherName})`,
      },
      isNot,
    })

    function testRunnerUnit({ received, expected, options, pass, not, throws }: TestCase) {
      const actVol = makeVol(received)

      if (throws) {
        const matcher = toHaveVolumeEntries.bind(mockState(not))
        expect(() => matcher(actVol, expected, options)).toThrowErrorMatchingSnapshot()
        return
      }

      const invoke = () => {
        const matcher = toHaveVolumeEntries.bind(mockState(not))
        try {
          const result = matcher(actVol, expected, options) as any
          return { ...result, message: result.message() }
        } catch (error) {
          return error
        }
      }

      const result = invoke()
      if (pass != null) expect(result).toHaveProperty('pass', not ? !pass : pass)
      expect(result).toMatchSnapshot('result')
    }

    it.each(cases.normal)('$name', testRunnerUnit)
    it.only.each(cases.only)('$name', testRunnerUnit)
    it.skip.each(cases.skip)('$name', testRunnerUnit)
  })

  describe('integration', () => {
    function testRunnerInteg({ received, expected, options, pass, not, throws }: TestCase) {
      const receivedVol = makeVol(received)

      if (throws) {
        expect(() =>
          expect(receivedVol).toHaveVolumeEntries(expected, options),
        ).toThrowErrorMatchingSnapshot()
        return
      }

      if (not) {
        if (pass) {
          expect(receivedVol).not.toHaveVolumeEntries(expected, options)
        } else {
          expect(() =>
            expect(receivedVol).not.toHaveVolumeEntries(expected, options),
          ).toThrowErrorMatchingSnapshot()
        }
      } else {
        if (pass) {
          expect(receivedVol).toHaveVolumeEntries(expected, options)
        } else {
          expect(() =>
            expect(receivedVol).toHaveVolumeEntries(expected, options),
          ).toThrowErrorMatchingSnapshot()
        }
      }
    }

    it.each(cases.normal)('$name', testRunnerInteg)
    it.only.each(cases.only)('$name', testRunnerInteg)
    it.skip.each(cases.skip)('$name', testRunnerInteg)
  })
})

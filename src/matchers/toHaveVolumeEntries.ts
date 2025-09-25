import { Volume } from 'memfs'
import { createMatcher } from '@/util/common.js'
import { scanVolumePaths } from '@/util/volume.js'
import { createMatchRules, matchEntries, VolumeEntries, MatchRules } from '@/util/volume-entries.js'

export interface VolumeEntriesMatcherOptions {
  /**
   * Prefix for resolving relative paths in the expected entries. Defaults to `/`.
   */
  prefix?: string
}

declare module 'vitest' {
  interface Matchers<T = any> {
    /**
     * Assert that specific paths exist in a memfs volume.
     */
    toHaveVolumeEntries(expected: VolumeEntries, options?: VolumeEntriesMatcherOptions): T
  }
}

export default createMatcher('toHaveVolumeEntries', function (received, expected, options) {
  const { utils, isNot } = this

  if (!(received instanceof Volume)) {
    return {
      pass: false,
      message: () => `Expected ${utils.printReceived(received)} to be a memfs Volume instance`,
      actual: received,
      expected: new (class Volume {})(),
    }
  }

  let rules: MatchRules
  try {
    rules = createMatchRules(expected, options?.prefix)
  } catch (error) {
    if (error instanceof Error) {
      throw new TypeError(
        `Invalid volume entries provided to ${utils.matcherHint('toHaveVolumeEntries')}. ${
          error.message
        }`,
      )
    }
    throw error
  }

  const pathEntries = scanVolumePaths(received)
  const result = matchEntries(pathEntries, rules)
  const { matches, missingCount, typeCount, diff } = result

  if (isNot) {
    // when .not, we assert that we found at least one expected entry
    const matchesCount = matches.length
    if (matchesCount > 0) {
      return {
        pass: true,
        message: () =>
          `Expected volume entries not to satisfy the expected entries, but it did ` +
          `(found ${matchesCount} match${matchesCount > 1 ? 'es' : ''})`,
        actual: Object.fromEntries(matches),
        expected: {},
      }
    }

    return {
      pass: false,
      message: () => `Volume entries did not satisfy the expected entries`,
    }
  }

  // we assert that we found all expected entries
  if (missingCount === 0 && typeCount === 0) {
    return {
      pass: true,
      message: () => 'Volume satisfied the expected entries',
    }
  }

  const counts: string[] = []
  if (missingCount) counts.push(`${missingCount} missing entr${missingCount > 1 ? 'ies' : 'y'}`)
  if (typeCount) counts.push(`${typeCount} path type mismatch${typeCount > 1 ? 'es' : ''}`)

  return {
    pass: false,
    message: () =>
      `Volume entries did not satisfy the expected entries (found ${counts.join(', ')})`,
    actual: diff.actual,
    expected: diff.expected,
  }
})

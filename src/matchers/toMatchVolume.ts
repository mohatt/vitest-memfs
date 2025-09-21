import { Volume } from 'memfs'
import { compareVolumeMaps, createMatcher, VolumeCompareOptions, volumeToMap } from '@/utils'

export interface VolumeMatcherOptions extends VolumeCompareOptions {
  prefix?: string
}

declare module 'vitest' {
  interface Matchers<T = any> {
    /**
     * Assert that a memfs volume matches another volume.
     */
    toMatchVolume(expected: Volume, options?: VolumeMatcherOptions): T
  }
}

export default createMatcher('toMatchVolume', function (received, expected, options) {
  const { utils } = this
  if (!(received instanceof Volume)) {
    return {
      pass: false,
      message: () => `expected ${utils.printReceived(received)} to be a memfs Volume instance`,
      actual: received,
      expected: new (class Volume {})(),
    }
  }

  if (!(expected instanceof Volume)) {
    throw new TypeError(
      `You must provide a memfs Volume instance to ${utils.matcherHint('toMatchVolume')}, not '${typeof expected}'.`,
    )
  }

  if (received === expected) {
    return {
      pass: true,
      message: () => 'volumes matched by reference',
    }
  }

  const prefix = options?.prefix ?? undefined
  const receivedMap = volumeToMap(received, prefix)
  const expectedMap = volumeToMap(expected, prefix)

  return compareVolumeMaps(receivedMap, expectedMap, options)
})

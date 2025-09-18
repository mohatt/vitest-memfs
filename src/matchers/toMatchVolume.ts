import { Volume } from 'memfs'
import { compareVolumeMaps, createMatcher, VolumeCompareListMatch, volumeToMap } from '@/utils'

interface VolumeMatcherOptions {
  listMatch?: VolumeCompareListMatch
}

declare module 'vitest' {
  interface Matchers<T = any> {
    /**
     * Compare this memfs volume against another memfs volume.
     */
    toMatchVolume(expected: Volume, options?: VolumeMatcherOptions): T
  }
}

const matcherName = 'toMatchVolume'

export default createMatcher(matcherName, function (received, expected, options) {
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
      `You must provide a memfs Volume instance to ${utils.matcherHint(matcherName)}, not '${typeof expected}'.`,
    )
  }

  if (received === expected) {
    return {
      pass: true,
      message: () => 'volumes matched by reference',
    }
  }

  const receivedMap = volumeToMap(received)
  const expectedMap = volumeToMap(expected)

  return compareVolumeMaps(receivedMap, expectedMap, options)
})

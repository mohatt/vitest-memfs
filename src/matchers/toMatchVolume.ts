import { Volume, DirectoryJSON } from 'memfs'
import { createMatcher } from '@/util/common.js'
import { volumeToMap } from '@/util/volume.js'
import { compareVolumeMaps, VolumeCompareOptions } from '@/util/volume-compare.js'

export interface VolumeMatcherOptions extends VolumeCompareOptions {
  prefix?: string
}

declare module 'vitest' {
  interface Matchers<T = any> {
    /**
     * Assert that a memfs volume matches another volume or JSON input.
     */
    toMatchVolume(expected: Volume | DirectoryJSON, options?: VolumeMatcherOptions): T
  }
}

export default createMatcher('toMatchVolume', function (received, expected, options) {
  const { utils } = this
  if (!(received instanceof Volume)) {
    return {
      pass: false,
      message: () => `Expected ${utils.printReceived(received)} to be a memfs Volume instance`,
      actual: received,
      expected: new (class Volume {})(),
    }
  }

  let expectedVol: Volume
  if (expected instanceof Volume) {
    expectedVol = expected
  } else if (Object.prototype.toString.call(expected) === '[object Object]') {
    expectedVol = Volume.fromJSON(expected)
  } else {
    throw new TypeError(
      `You must provide a memfs Volume instance or plain JSON object to ${utils.matcherHint(
        'toMatchVolume',
      )}, not \`${typeof expected}\`.`,
    )
  }

  if (received === expectedVol) {
    return {
      pass: true,
      message: () => 'Volumes matched by reference',
    }
  }

  const prefix = options?.prefix ?? undefined
  const withData = options?.contentMatch !== 'ignore' && options?.contentMatch !== 'ignore-files'
  const receivedMap = volumeToMap(received, { prefix, withData })
  const expectedMap = volumeToMap(expectedVol, { prefix, withData })

  return compareVolumeMaps(receivedMap, expectedMap, options)
})

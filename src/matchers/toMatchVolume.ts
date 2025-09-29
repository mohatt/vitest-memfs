import { Volume, DirectoryJSON } from 'memfs'
import { createMatcher, isPlainObject, resolvePrefix, resolveAbsPath } from '@/util/common.js'
import { volumeToMap } from '@/util/volume.js'
import { VolumeCompare, VolumeCompareOptions } from '@/util/volume-compare.js'

export interface VolumeMatcherOptions<Async extends boolean> extends VolumeCompareOptions<Async> {
  prefix?: string
}

declare module 'vitest' {
  interface Matchers<T = any> {
    /**
     * Assert that a memfs volume matches another volume or JSON input.
     */
    toMatchVolume(expected: Volume | DirectoryJSON, options: VolumeMatcherOptions<true>): Promise<T>
    toMatchVolume(expected: Volume | DirectoryJSON, options?: VolumeMatcherOptions<false>): T
  }
}

export default createMatcher('toMatchVolume', function (received, expected, options) {
  const { utils, isNot } = this
  if (!(received instanceof Volume)) {
    return {
      pass: false,
      message: () => `Expected ${utils.printReceived(received)} to be a memfs Volume instance`,
      actual: received,
      expected: new (class Volume {})(),
    }
  }

  const prefix = resolvePrefix(options?.prefix)
  let expectedVol: Volume
  if (expected instanceof Volume) {
    expectedVol = expected
  } else if (isPlainObject(expected)) {
    let resolved = expected
    if (prefix !== '/') {
      resolved = {}
      for (const key of Object.keys(expected)) {
        resolved[resolveAbsPath(key, prefix)] = expected[key]
      }
    }
    expectedVol = Volume.fromJSON(resolved)
  } else {
    throw new TypeError(
      `You must provide a memfs Volume instance or plain JSON object to ${utils.matcherHint(
        'toMatchVolume',
      )}, not \`${typeof expected}\``,
    )
  }

  if (received === expectedVol) {
    return {
      pass: true,
      message: () => 'Volumes matched by reference',
    }
  }

  const receivedMap = volumeToMap(received, { prefix })
  const expectedMap = volumeToMap(expectedVol, { prefix })

  const cmp = new VolumeCompare(receivedMap, expectedMap, options)
  const result = cmp.compare()
  const handle = (res: Awaited<typeof result>) => {
    if (res.pass === true) {
      return {
        pass: true,
        message: () =>
          isNot //
            ? 'Expected volumes to not match, but they did'
            : 'Volumes matched',
      }
    }
    return res
  }

  return result instanceof Promise ? result.then(handle) : handle(result)
})

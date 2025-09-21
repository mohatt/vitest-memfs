import path from 'path'
import { Volume } from 'memfs'
import { createMatcher, getActualFS } from '@/util/common.js'
import { readDirToMap, volumeToMap, writeVolumeToDir } from '@/util/volume.js'
import { compareVolumeMaps, VolumeCompareOptions } from '@/util/volume-compare.js'

export interface VolumeSnapshotMatcherOptions extends VolumeCompareOptions {
  prefix?: string
}

declare module 'vitest' {
  interface Matchers<T = any> {
    /**
     * Assert that a memfs volume matches the snapshot directory.
     */
    toMatchVolumeSnapshot(snapshotDir: string, options?: VolumeSnapshotMatcherOptions): Promise<T>
  }
}

export default createMatcher(
  'toMatchVolumeSnapshot',
  async function (received, snapshotDir, options) {
    if (this.isNot) {
      throw new Error(`toMatchVolumeSnapshot() cannot be used with "not"`)
    }

    const { currentTestName, snapshotState, utils } = this
    const snapshotDirPath = path.join(path.dirname(snapshotState.snapshotPath), snapshotDir)
    const matchSnapshot = (passed: boolean) => {
      snapshotState.match({
        testId: currentTestName,
        testName: currentTestName,
        received: passed ? 'match' : 'mismatch',
        isInline: false,
        rawSnapshot: {
          file: snapshotDirPath,
          content: 'match',
          readonly: true,
        },
      })
      return passed
    }

    if (!(received instanceof Volume)) {
      return {
        pass: matchSnapshot(false),
        message: () => `expected ${utils.printReceived(received)} to be a memfs Volume instance`,
        actual: received,
        expected: new (class Volume {})(),
      }
    }

    const fs = await getActualFS()
    const updateSnapshot =
      (snapshotState as any)._updateSnapshot === 'all' ||
      (await fs
        .access(snapshotDirPath)
        .then(() => false)
        .catch(() => true))

    const prefix = options?.prefix ?? undefined
    if (updateSnapshot) {
      await writeVolumeToDir(received, snapshotDirPath, { prefix, clear: true })
      return { pass: true, message: () => `updated snapshot at ${snapshotDir}` }
    }

    const expectedMap = await readDirToMap(snapshotDirPath, prefix)
    const receivedMap = volumeToMap(received, prefix)

    const result = compareVolumeMaps(receivedMap, expectedMap, options)
    matchSnapshot(result.pass)
    return result
  },
)

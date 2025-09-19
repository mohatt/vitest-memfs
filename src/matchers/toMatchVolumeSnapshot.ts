import path from 'path'
import { Volume } from 'memfs'
import {
  compareVolumeMaps,
  createMatcher,
  getActualFS,
  readDirToMap,
  VolumeCompareListMatch,
  volumeToMap,
  writeVolumeToDir,
} from '@/utils'

export interface VolumeSnapshotMatcherOptions {
  prefix?: string
  listMatch?: VolumeCompareListMatch
}

declare module 'vitest' {
  interface Matchers<T = any> {
    /**
     * Assert that a memfs volume matches the snapshot directory.
     */
    toMatchVolumeSnapshot(targetDir: string, options?: VolumeSnapshotMatcherOptions): Promise<T>
  }
}

const matcherName = 'toMatchVolumeSnapshot'

export default createMatcher(matcherName, async function (received, snapshotDir, options) {
  if (this.isNot) {
    throw new Error(`${matcherName} cannot be used with "not"`)
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
    return { pass: true, message: () => `updated snapshot at ${snapshotDirPath}` }
  }

  const expectedMap = await readDirToMap(snapshotDirPath, prefix)
  const receivedMap = volumeToMap(received, prefix)

  const result = compareVolumeMaps(receivedMap, expectedMap, options)
  matchSnapshot(result.pass)
  return result
})

import path from 'path'
import type { SnapshotUpdateState } from 'vitest'
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
    if (!snapshotDir || typeof snapshotDir !== 'string') {
      throw new TypeError(
        `You must provide a snapshot directory name to ${utils.matcherHint(
          'toMatchVolumeSnapshot',
        )}, not \`${typeof snapshotDir}\`.`,
      )
    }

    const fs = await getActualFS()
    const testId = `${currentTestName} > volume snapshots > ${snapshotDir}`
    const snapshotDirPath = path.join(path.dirname(snapshotState.snapshotPath), snapshotDir)
    const updateSnapshot: SnapshotUpdateState = (snapshotState as any)._updateSnapshot
    const hasSnapshot = await fs
      .lstat(snapshotDirPath)
      .then((s) => s.isDirectory())
      .catch(() => false)
    const updateSnapshotState = (passed: boolean) => {
      if (
        (hasSnapshot && updateSnapshot === 'all') ||
        (!hasSnapshot && (updateSnapshot === 'new' || updateSnapshot === 'all'))
      ) {
        if (updateSnapshot === 'all') {
          if (!passed) {
            if (hasSnapshot) {
              snapshotState.unmatched.increment(testId)
            }
          } else {
            hasSnapshot //
              ? snapshotState.updated.increment(testId)
              : snapshotState.added.increment(testId)
          }
        } else {
          snapshotState.added.increment(testId)
        }
      } else {
        passed //
          ? snapshotState.matched.increment(testId)
          : snapshotState.unmatched.increment(testId)
      }
      return passed
    }

    if (!(received instanceof Volume)) {
      return {
        pass: updateSnapshotState(false),
        message: () => `expected ${utils.printReceived(received)} to be a memfs Volume instance`,
        actual: received,
        expected: new (class Volume {})(),
      }
    }

    const prefix = options?.prefix ?? undefined
    if (updateSnapshot === 'all' || (updateSnapshot !== 'none' && !hasSnapshot)) {
      await writeVolumeToDir(received, snapshotDirPath, { prefix, clear: true })
      return {
        pass: updateSnapshotState(true),
        message: () => `${hasSnapshot ? 'updated' : 'created'} snapshot at ${snapshotDir}`,
      }
    }

    if (!hasSnapshot) {
      return {
        pass: updateSnapshotState(false),
        message: () => `snapshot directory \`${snapshotDir}\` does not exist`,
      }
    }

    const expectedMap = await readDirToMap(snapshotDirPath, prefix)
    const receivedMap = volumeToMap(received, prefix)

    const result = compareVolumeMaps(receivedMap, expectedMap, options)
    updateSnapshotState(result.pass)
    return result
  },
)

import path from 'path'
import type { SnapshotUpdateState } from 'vitest'
import { Volume } from 'memfs'
import { createMatcher, importActualFS, resolvePrefix } from '@/util/common.js'
import { readDirToMap, volumeToMap, writeVolumeToDir } from '@/util/volume.js'
import { VolumeCompare, VolumeCompareOptions } from '@/util/volume-compare.js'

export interface VolumeSnapshotMatcherOptions extends VolumeCompareOptions<true> {
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
      throw new Error('toMatchVolumeSnapshot() cannot be used with `not`')
    }

    const { currentTestName, snapshotState, utils } = this
    if (!snapshotDir || typeof snapshotDir !== 'string') {
      throw new TypeError(
        `You must provide a snapshot directory name to ${utils.matcherHint(
          'toMatchVolumeSnapshot',
        )}, not \`${typeof snapshotDir}\``,
      )
    }

    const fs = await importActualFS()
    const testId = `${currentTestName} > volume snapshots > ${snapshotDir}`
    const snapshotDirPath = path.join(path.dirname(snapshotState.snapshotPath), snapshotDir)
    const updateSnapshot: SnapshotUpdateState = (snapshotState as any)._updateSnapshot
    const hasSnapshot = await fs.promises
      .lstat(snapshotDirPath)
      .then((s) => s.isDirectory())
      .catch(() => false)

    function updateSnapshotState(passed: boolean) {
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
        message: () => `Expected ${utils.printReceived(received)} to be a memfs Volume instance`,
        actual: received,
        expected: new (class Volume {})(),
      }
    }

    const prefix = resolvePrefix(options?.prefix)
    if (updateSnapshot === 'all' || (updateSnapshot !== 'none' && !hasSnapshot)) {
      await writeVolumeToDir(received, snapshotDirPath, {
        clear: true,
        withData: options?.contentMatch !== 'ignore' && options?.contentMatch !== 'ignore-files',
        concurrency: options?.concurrency ?? undefined,
        prefix,
      })
      return {
        pass: updateSnapshotState(true),
        message: () => `${hasSnapshot ? 'Updated' : 'Created'} snapshot at ${snapshotDir}`,
      }
    }

    if (!hasSnapshot) {
      return {
        pass: updateSnapshotState(false),
        message: () => `Snapshot directory \`${snapshotDir}\` does not exist`,
      }
    }

    const expectedMap = await readDirToMap(snapshotDirPath, { prefix })
    const receivedMap = volumeToMap(received, { prefix })

    const cmp = new VolumeCompare(receivedMap, expectedMap, { ...options, async: true })
    const result = await cmp.compare()
    updateSnapshotState(result.pass)

    if (result.pass === true) {
      return {
        pass: true,
        message: () => `Volume matched the snapshot at ${snapshotDir}`,
      }
    }

    return result
  },
)

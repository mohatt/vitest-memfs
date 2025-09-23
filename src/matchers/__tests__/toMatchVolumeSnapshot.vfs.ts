import { vi, describe, expect, it } from 'vitest'
import { lstat } from 'fs/promises'
import { makeVol } from '@test/util.js'

// Use virtual file system global mocks
vi.mock('fs')
vi.mock('fs/promises')

describe('toMatchVolumeSnapshot() [vfs]', () => {
  it('works correctly with fs mock', async () => {
    const vol = makeVol({ '/foo.txt': 'hi' })
    await expect(vol).toMatchVolumeSnapshot('test-vfs')
    expect(lstat).not.toBeCalled() // lstat here is mocked, it should never be called
  })
})

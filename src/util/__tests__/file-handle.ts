import { afterAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { makeVol } from '@test/util.js'
import { FileHandle, type FileCompareResult } from '../file-handle.js'

const STREAM_THRESHOLD = 32 * 1024 * 1024
const LARGE_FILE_SIZE = STREAM_THRESHOLD + 1024

const tempDirs: string[] = []

afterAll(async () => {
  await Promise.all(tempDirs.map((dir) => fs.promises.rm(dir, { recursive: true, force: true })))
})

function makeTempDir(name: string) {
  const dir = fs.mkdtempSync(path.join(tmpdir(), name))
  tempDirs.push(dir)
  return dir
}

function makeVolHandle(filePath: string, data: string | Buffer) {
  const vol = makeVol({ [filePath]: data })
  const { size } = vol.statSync(filePath)
  return new FileHandle(vol, filePath, size)
}

function serializeDiff(diff: FileCompareResult | null) {
  if (diff == null) throw new Error('Expected diff payload')
  if ('buffer' in diff) {
    return {
      ...diff,
      buffer: diff.buffer.map((buf) => buf.toString(diff.text ? 'utf8' : 'hex')),
    }
  }
  return diff
}

describe('FileHandle', () => {
  describe('compare()', () => {
    it('returns null diff for identical volume files', async () => {
      const a = makeVolHandle('/file.txt', 'hello world')
      const b = makeVolHandle('/file.txt', 'hello world')
      await expect(a.compare(b)).resolves.toBeNull()
    })

    it('returns buffer diff for small text mismatches', async () => {
      const a = makeVolHandle('/file.txt', 'hello world')
      const b = makeVolHandle('/file.txt', 'hello there')
      const diff = await a.compare(b)
      expect(serializeDiff(diff)).toMatchSnapshot()
    })

    it('returns hash diff for large binary mismatches', async () => {
      const aData = Buffer.alloc(LARGE_FILE_SIZE, 0xaa)
      const bData = Buffer.alloc(LARGE_FILE_SIZE, 0xbb)
      const a = makeVolHandle('/big.bin', aData)
      const b = makeVolHandle('/big.bin', bData)
      const diff = await a.compare(b)
      expect(serializeDiff(diff)).toMatchSnapshot()
    })

    it('reports size mismatches for large files without hashing', async () => {
      const aData = Buffer.alloc(LARGE_FILE_SIZE, 0xaa)
      const bData = Buffer.alloc(LARGE_FILE_SIZE - 1024, 0xaa)
      const a = makeVolHandle('/big.bin', aData)
      const b = makeVolHandle('/big.bin', bData)
      const diff = await a.compare(b)
      expect(serializeDiff(diff)).toMatchSnapshot()
    })

    it('switches to hash diff when buffer length exceeds the threshold', async () => {
      const size = 2.5 * 1024 * 1024 + 1024
      const a = makeVolHandle('/big.bin', Buffer.alloc(size, 0xaa))
      const b = makeVolHandle('/big.bin', Buffer.alloc(1024 * 1024, 0xbb))

      const diff = await a.compare(b)
      expect(serializeDiff(diff)).toMatchSnapshot()
    })

    it('compares volume and real files', async () => {
      const dir = makeTempDir('file-handle-compare-')
      const diskPath = path.join(dir, 'mirror.txt')
      const data = 'mirror contents'
      fs.writeFileSync(diskPath, data)

      const volumeHandle = makeVolHandle('/mirror.txt', data)
      const diskHandle = new FileHandle(fs, diskPath, data.length)

      await expect(volumeHandle.compare(diskHandle)).resolves.toBeNull()
      await expect(diskHandle.compare(volumeHandle)).resolves.toBeNull()
    })

    it('respects aborted signals when reading from disk', async () => {
      const dir = makeTempDir('file-handle-abort-')
      const leftPath = path.join(dir, 'left.txt')
      const rightPath = path.join(dir, 'right.txt')
      fs.writeFileSync(leftPath, 'alpha')
      fs.writeFileSync(rightPath, 'alpha')

      const left = new FileHandle(fs, leftPath, fs.statSync(leftPath).size)
      const right = new FileHandle(fs, rightPath, fs.statSync(rightPath).size)

      const diff = await left.compare(right, AbortSignal.abort())
      expect(serializeDiff(diff)).toMatchSnapshot()
    })

    it('respects aborted signals when streaming large files', async () => {
      const aData = Buffer.alloc(LARGE_FILE_SIZE, 0xaa)
      const bData = Buffer.alloc(LARGE_FILE_SIZE, 0xbb)
      const a = makeVolHandle('/big.bin', aData)
      const b = makeVolHandle('/big.bin', bData)
      const diff = await a.compare(b, AbortSignal.abort())
      expect(serializeDiff(diff)).toMatchSnapshot()
    })
  })

  describe('compareSync()', () => {
    it('returns null for identical small files', () => {
      const received = makeVolHandle('/file.txt', 'same')
      const expected = makeVolHandle('/file.txt', 'same')

      const diff = received.compareSync(expected)
      expect(diff).toBeNull()
    })

    it('returns diff for small mismatches', () => {
      const received = makeVolHandle('/file.txt', 'alpha')
      const expected = makeVolHandle('/file.txt', 'alpHa')

      const diff = received.compareSync(expected)
      expect(serializeDiff(diff)).toMatchSnapshot()
    })

    it('throws beyond the sync size threshold', () => {
      const data = Buffer.alloc(17 * 1024 * 1024, 0xaa)
      const received = makeVolHandle('/huge.bin', data)
      const expected = makeVolHandle('/huge.bin', data)

      expect(() => received.compareSync(expected)).toThrow(/Use { async: true }/)
    })
  })

  describe('replaceWith()', () => {
    it('streams when copying large files between volumes', async () => {
      const targetVolume = makeVol()
      const source = makeVolHandle('/large.bin', Buffer.alloc(LARGE_FILE_SIZE, 0xcc))
      const dest = new FileHandle(targetVolume, '/copy.bin', 0)

      await expect(dest.replaceWith(source)).resolves.toBeUndefined()
      expect(dest.size).toBe(source.size)
      await expect(dest.compare(source)).resolves.toBeNull()
    })

    it('copies small files without streaming', async () => {
      const data = 'mini data'
      const source = makeVolHandle('/small.txt', data)
      const targetVolume = makeVol()
      const dest = new FileHandle(targetVolume, '/small.txt', 0)

      await expect(dest.replaceWith(source)).resolves.toBeUndefined()

      expect(dest.size).toBe(data.length)
      const written = targetVolume.readFileSync('/small.txt', 'utf8')
      expect(written).toBe(data)
    })

    it('mirrors volume files to the real filesystem', async () => {
      const dir = makeTempDir('file-handle-replace-')
      const diskPath = path.join(dir, 'asset.bin')

      const payload = Buffer.from('assets!', 'utf8')
      const source = makeVolHandle('/asset.bin', payload)
      const dest = new FileHandle(fs, diskPath, 0)

      await expect(dest.replaceWith(source)).resolves.toBeUndefined()

      const diskBuffer = fs.readFileSync(diskPath)
      expect(diskBuffer).toEqual(payload)
      expect(dest.size).toBe(payload.length)

      const diskHandle = new FileHandle(fs, diskPath, diskBuffer.length)
      await expect(diskHandle.compare(source)).resolves.toBeNull()
    })
  })

  describe('makeBufferDiff()', () => {
    it('captures mismatch close to the start of the file', async () => {
      const received = makeVolHandle('/file.txt', 'XXY' + 'a'.repeat(40))
      const expected = makeVolHandle('/file.txt', 'YYZ' + 'a'.repeat(40))

      const diff = await received.compare(expected)
      expect(serializeDiff(diff)).toMatchSnapshot()
    })

    it('captures mismatch near the middle with trimmed context', async () => {
      const prefix = 'a'.repeat(70)
      const suffix = 'b'.repeat(70)
      const received = makeVolHandle('/file.txt', `${prefix}X${suffix}`)
      const expected = makeVolHandle('/file.txt', `${prefix}YY${suffix}`)

      const diff = await received.compare(expected)
      expect(serializeDiff(diff)).toMatchSnapshot()
    })

    it('captures mismatch near the end of the file', async () => {
      const common = 'line\n'.repeat(10) + 'end'
      const received = makeVolHandle('/file.txt', `${common}XXY`)
      const expected = makeVolHandle('/file.txt', `${common}YYZ`)

      const diff = await received.compare(expected)
      expect(serializeDiff(diff)).toMatchSnapshot()
    })

    it('captures binary mismatch near the start of the file', async () => {
      const base = Buffer.alloc(64, 0xaa)
      const received = makeVolHandle('/file.bin', Buffer.from([0x00, ...base.subarray(1)]))
      const expected = makeVolHandle('/file.bin', Buffer.from([0xff, ...base.subarray(1)]))

      const diff = await received.compare(expected)
      expect(serializeDiff(diff)).toMatchSnapshot()
    })

    it('captures binary mismatch when files have different lengths', async () => {
      const base = Buffer.alloc(96, 0xbb)
      const received = makeVolHandle('/file.bin', Buffer.from(base))
      const expected = makeVolHandle(
        '/file.bin',
        Buffer.concat([base, Buffer.from([0xcc, 0xdd, 0xee, 0xff])]),
      )

      const diff = await received.compare(expected)
      expect(serializeDiff(diff)).toMatchSnapshot()
    })
  })
})

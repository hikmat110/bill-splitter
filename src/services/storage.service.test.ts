import { afterAll, describe, expect, test } from 'bun:test'
import { rm } from 'node:fs/promises'
import {
  attachmentPath,
  deleteAttachment,
  isAllowedMime,
  readAttachment,
  saveImage,
  StorageError,
} from './storage.service'
import { config } from '../config'

const PNG_HEADER = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const JPEG_HEADER = [0xff, 0xd8, 0xff, 0xe0]

function bytesWith(header: number[], total = 32): Uint8Array {
  const b = new Uint8Array(total)
  b.set(header, 0)
  return b
}

const created: { id: string; mime: string }[] = []

afterAll(async () => {
  for (const a of created) await deleteAttachment(a.id, a.mime)
})

describe('isAllowedMime', () => {
  test('accepts known image mimes', () => {
    expect(isAllowedMime('image/jpeg')).toBe(true)
    expect(isAllowedMime('image/png')).toBe(true)
    expect(isAllowedMime('image/webp')).toBe(true)
  })
  test('rejects everything else', () => {
    expect(isAllowedMime('application/pdf')).toBe(false)
    expect(isAllowedMime('image/gif')).toBe(false)
    expect(isAllowedMime('text/plain')).toBe(false)
  })
})

describe('attachmentPath', () => {
  test('uses the canonical extension for the mime', () => {
    expect(attachmentPath('abc', 'image/jpeg').endsWith('abc.jpg')).toBe(true)
    expect(attachmentPath('abc', 'image/png').endsWith('abc.png')).toBe(true)
    expect(attachmentPath('abc', 'image/webp').endsWith('abc.webp')).toBe(true)
  })
})

describe('saveImage', () => {
  test('rejects a disallowed mime', async () => {
    await expect(saveImage(bytesWith(PNG_HEADER), 'image/gif')).rejects.toBeInstanceOf(StorageError)
  })

  test('rejects when bytes do not match the claimed mime (magic-byte sniff)', async () => {
    // PNG header but claimed as JPEG
    await expect(saveImage(bytesWith(PNG_HEADER), 'image/jpeg')).rejects.toMatchObject({
      code: 'bad_mime',
    })
  })

  test('rejects oversize payloads', async () => {
    const big = bytesWith(PNG_HEADER, config.MAX_UPLOAD_BYTES + 1)
    await expect(saveImage(big, 'image/png')).rejects.toMatchObject({ code: 'too_large' })
  })

  test('persists a valid image and round-trips via readAttachment', async () => {
    const stored = await saveImage(bytesWith(JPEG_HEADER), 'image/jpeg')
    created.push(stored)
    expect(stored.mime).toBe('image/jpeg')
    expect(stored.size).toBe(32)

    const read = await readAttachment(stored.id, stored.mime)
    expect(read).not.toBeNull()
    expect(read!.mime).toBe('image/jpeg')
  })

  test('deleteAttachment removes the file; readAttachment then returns null', async () => {
    const stored = await saveImage(bytesWith(PNG_HEADER), 'image/png')
    await deleteAttachment(stored.id, stored.mime)
    expect(await readAttachment(stored.id, stored.mime)).toBeNull()
  })
})

// Local image storage. Owns the bytes on disk under config.UPLOAD_DIR — no DB,
// no HTTP. The DB only ever stores an opaque attachment id + mime; this module
// maps that pair to a file path. Used by both the bot (receipt/proof photos
// downloaded from Telegram) and the Mini App API (multipart uploads).

import { mkdirSync } from 'node:fs'
import { unlink } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import type { BunFile } from 'bun'
import { config } from '../config'

// Single source of truth for "is this an allowed image", mapping each mime to a
// canonical on-disk extension. Anything not here is rejected.
const ALLOWED_MIME = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
} as const

export type AllowedMime = keyof typeof ALLOWED_MIME

export function isAllowedMime(mime: string): mime is AllowedMime {
  return mime in ALLOWED_MIME
}

export interface StoredAttachment {
  id: string
  mime: AllowedMime
  size: number
}

export class StorageError extends Error {
  constructor(
    public code: 'bad_mime' | 'too_large',
    message: string
  ) {
    super(message)
    this.name = 'StorageError'
  }
}

// Resolve UPLOAD_DIR to an absolute path once, and ensure it exists at startup.
const UPLOAD_ROOT = isAbsolute(config.UPLOAD_DIR)
  ? config.UPLOAD_DIR
  : resolve(process.cwd(), config.UPLOAD_DIR)
mkdirSync(UPLOAD_ROOT, { recursive: true })

/** Absolute on-disk path for an attachment. Pure — no I/O. */
export function attachmentPath(id: string, mime: string): string {
  const ext = isAllowedMime(mime) ? ALLOWED_MIME[mime] : 'bin'
  // `id` is a server-generated uuid and `ext` comes from the fixed allow-list,
  // so there are no user-controlled path segments (no traversal possible).
  return join(UPLOAD_ROOT, `${id}.${ext}`)
}

/** Verify the first bytes actually match the claimed image mime. Clients (and
 *  even Telegram's reported mime) can lie about Content-Type, so this is the
 *  real guard, not the header. */
function magicBytesMatch(bytes: Uint8Array, mime: AllowedMime): boolean {
  switch (mime) {
    case 'image/jpeg':
      return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    case 'image/png':
      return (
        bytes.length >= 8 &&
        bytes[0] === 0x89 &&
        bytes[1] === 0x50 &&
        bytes[2] === 0x4e &&
        bytes[3] === 0x47 &&
        bytes[4] === 0x0d &&
        bytes[5] === 0x0a &&
        bytes[6] === 0x1a &&
        bytes[7] === 0x0a
      )
    case 'image/webp':
      // "RIFF" .... "WEBP"
      return (
        bytes.length >= 12 &&
        bytes[0] === 0x52 &&
        bytes[1] === 0x49 &&
        bytes[2] === 0x46 &&
        bytes[3] === 0x46 &&
        bytes[8] === 0x57 &&
        bytes[9] === 0x45 &&
        bytes[10] === 0x42 &&
        bytes[11] === 0x50
      )
  }
}

/** Validate + persist raw image bytes. Throws StorageError on bad mime / oversize. */
export async function saveImage(
  bytes: Uint8Array | ArrayBuffer,
  mime: string
): Promise<StoredAttachment> {
  if (!isAllowedMime(mime)) {
    throw new StorageError('bad_mime', `Unsupported image type: ${mime}`)
  }
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  if (data.byteLength > config.MAX_UPLOAD_BYTES) {
    throw new StorageError('too_large', `Image exceeds ${config.MAX_UPLOAD_BYTES} bytes`)
  }
  if (!magicBytesMatch(data, mime)) {
    throw new StorageError('bad_mime', 'File contents do not match an image format')
  }

  const id = crypto.randomUUID()
  await Bun.write(attachmentPath(id, mime), data)
  return { id, mime, size: data.byteLength }
}

/** A BunFile for streaming to an HTTP response, or null if missing on disk. */
export async function readAttachment(
  id: string,
  mime: string
): Promise<{ file: BunFile; mime: string } | null> {
  const file = Bun.file(attachmentPath(id, mime))
  if (!(await file.exists())) return null
  return { file, mime }
}

/** Best-effort delete (used when an edit replaces the main photo). Never throws. */
export async function deleteAttachment(id: string, mime: string): Promise<void> {
  try {
    await unlink(attachmentPath(id, mime))
  } catch {
    // missing/already-gone — nothing to do
  }
}

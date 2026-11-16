// Telegram profile-photo cache. Photos are fetched via the Bot API (the file
// URL embeds the bot token, so clients can never fetch them directly) and
// cached on disk next to the uploads. "No visible photo" is also cached (as a
// zero-byte marker) so photo-less users don't trigger a Bot API call per view.

import { mkdirSync } from 'node:fs'
import { unlink } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { Api } from 'grammy'
import type { PhotoSize } from 'grammy/types'
import { config } from '../config'
import { rootLogger } from '../bot/middleware/logger'
import { downloadTelegramFile } from './telegram-file.service'

type AvatarFile = ReturnType<typeof Bun.file>

const log = rootLogger.child({ module: 'avatar' })

const AVATAR_ROOT = join(resolve(config.UPLOAD_DIR), 'avatars')
mkdirSync(AVATAR_ROOT, { recursive: true })

/** Re-check Telegram for photo changes (or newly set photos) after this long. */
const TTL_MS = 24 * 60 * 60 * 1000

// The key is a server-produced bigint, never client input — no traversal risk.
const photoPath = (telegramId: bigint) => join(AVATAR_ROOT, `tg-${telegramId}.jpg`)
const nonePath = (telegramId: bigint) => join(AVATAR_ROOT, `tg-${telegramId}.none`)

function isFresh(lastModified: number): boolean {
  return Date.now() - lastModified < TTL_MS
}

/**
 * The size to cache: avatars render at ≤56 CSS px, so the smallest variant of
 * at least 160px is plenty; fall back to the largest available. Explicit width
 * comparison — Telegram sends sizes ascending in practice but doesn't promise it.
 */
export function pickAvatarSize(sizes: PhotoSize[]): PhotoSize | null {
  if (sizes.length === 0) return null
  const bigEnough = sizes.filter((s) => s.width >= 160)
  if (bigEnough.length > 0) {
    return bigEnough.reduce((min, s) => (s.width < min.width ? s : min))
  }
  return sizes.reduce((max, s) => (s.width > max.width ? s : max))
}

// Simultaneous mounts (a bill screen renders many avatars at once) must not
// stampede getUserProfilePhotos for the same person.
const inflight = new Map<string, Promise<AvatarFile | null>>()

/**
 * The cached profile photo for a Telegram user, refreshing from the Bot API
 * when stale. Returns null when the user has no visible photo. Never throws —
 * on Telegram/network errors a stale cached photo is served if one exists.
 */
export async function getAvatarFile(api: Api, telegramId: bigint): Promise<AvatarFile | null> {
  const jpg = Bun.file(photoPath(telegramId))
  if ((await jpg.exists()) && isFresh(jpg.lastModified)) return jpg

  const none = Bun.file(nonePath(telegramId))
  if ((await none.exists()) && isFresh(none.lastModified)) return null

  const key = telegramId.toString()
  const existing = inflight.get(key)
  if (existing) return existing

  const task = refreshAvatar(api, telegramId).finally(() => inflight.delete(key))
  inflight.set(key, task)
  return task
}

async function refreshAvatar(api: Api, telegramId: bigint): Promise<AvatarFile | null> {
  try {
    // Telegram ids are far below 2^53, and grammY's signature wants a number.
    const photos = await api.getUserProfilePhotos(Number(telegramId), { offset: 0, limit: 1 })
    const sizes = photos.photos[0] ?? []
    const size = pickAvatarSize(sizes)

    if (!size) {
      // A successful "no visible photo" answer (includes privacy-restricted
      // users) — negative-cache it so we don't ask again for a day.
      await Bun.write(nonePath(telegramId), new Uint8Array(0))
      await unlink(photoPath(telegramId)).catch(() => undefined)
      return null
    }

    const bytes = await downloadTelegramFile(api, size.file_id)
    await Bun.write(photoPath(telegramId), bytes)
    await unlink(nonePath(telegramId)).catch(() => undefined)
    return Bun.file(photoPath(telegramId))
  } catch (err) {
    // Transport/API failure (not a "no photo" answer): keep whatever we have.
    log.warn({ err }, 'avatar fetch failed')
    const stale = Bun.file(photoPath(telegramId))
    return (await stale.exists()) ? stale : null
  }
}

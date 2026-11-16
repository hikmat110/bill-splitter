// Session cache for Telegram profile-photo avatars. Avatars mount dozens of
// times across screens, so unlike AuthImage every result (including "has no
// photo") is kept for the whole session — object URLs are tiny and bounded by
// the user's contact count, so they're never revoked.

import { getInitData } from './telegram'

const resolved = new Map<string, string | null>()
const inflight = new Map<string, Promise<string | null>>()

/** Sync lookup: an object URL, null (known no-photo), or undefined (never fetched). */
export function cachedAvatarUrl(contactId: string): string | null | undefined {
  return resolved.get(contactId)
}

/** Fetch (or join the in-flight fetch for) a contact's avatar object URL. */
export function avatarObjectUrl(contactId: string): Promise<string | null> {
  const known = resolved.get(contactId)
  if (known !== undefined) return Promise.resolve(known)
  const running = inflight.get(contactId)
  if (running) return running

  const task = fetchAvatar(contactId).finally(() => inflight.delete(contactId))
  inflight.set(contactId, task)
  return task
}

async function fetchAvatar(contactId: string): Promise<string | null> {
  try {
    const res = await fetch(`/api/avatars/${contactId}`, {
      headers: { Authorization: `tma ${getInitData()}` },
    })
    if (res.ok) {
      const url = URL.createObjectURL(await res.blob())
      resolved.set(contactId, url)
      return url
    }
    if (res.status === 404) {
      // Definitive "no photo" — remember it for the session.
      resolved.set(contactId, null)
    }
    // Other statuses are transient (5xx, auth hiccups): don't cache, retry on
    // the next mount.
    return null
  } catch {
    // Network failure — likewise transient.
    return null
  }
}

/**
 * Telegram deep links, both directions:
 *  - `t.me/<bot>?start=<payload>` opens the private chat and delivers <payload>
 *    as ctx.match. Telegram allows up to 64 characters of [A-Za-z0-9_-].
 *  - `t.me/<bot>/<app>?startapp=<payload>` opens a direct-link Mini App, which
 *    is the only way to launch the app straight from a group (inline web_app
 *    buttons are private-chat-only).
 *
 * Pure and dependency-free so payload parsing — the part that faces untrusted
 * input — is unit-testable.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Max length Telegram accepts for a `start` / `startapp` payload. */
export const MAX_PAYLOAD_LENGTH = 64

export const ADD_CONTACTS_PARAM = 'add_contacts'
export const GROUP_SPLIT_PREFIX = 'gs_'

export type DeepLink =
  | { kind: 'add_contacts' }
  | { kind: 'group_split'; splitId: string }
  | { kind: 'none' }

/**
 * Parse a /start or ?startapp payload. Anything unrecognised becomes `none` —
 * never echoed back to the user and never partially matched, so a malformed or
 * hostile payload can only ever be a no-op.
 */
export function parseStartPayload(raw: string | null | undefined): DeepLink {
  if (!raw) return { kind: 'none' }
  if (raw.length > MAX_PAYLOAD_LENGTH) return { kind: 'none' }
  if (raw === ADD_CONTACTS_PARAM) return { kind: 'add_contacts' }
  if (raw.startsWith(GROUP_SPLIT_PREFIX)) {
    const id = raw.slice(GROUP_SPLIT_PREFIX.length)
    return UUID_RE.test(id) ? { kind: 'group_split', splitId: id } : { kind: 'none' }
  }
  return { kind: 'none' }
}

/** `gs_<uuid>` — 39 chars, comfortably inside the 64-char payload budget. */
export function buildSplitPayload(splitId: string): string {
  return `${GROUP_SPLIT_PREFIX}${splitId}`
}

/** Link that opens the private chat with the bot and delivers `payload`. */
export function startLink(botUsername: string, payload: string): string {
  return `https://t.me/${botUsername}?start=${payload}`
}

/**
 * Best available way to open the Mini App for `payload`.
 *
 * With a BotFather app short name configured this is a direct-link Mini App,
 * which opens full-screen straight from the group. Without one it degrades to
 * the private-chat bounce, which always works — so the feature ships before
 * anyone touches BotFather.
 */
export function miniAppLink(
  botUsername: string,
  shortName: string | undefined,
  payload: string
): string {
  if (!shortName) return startLink(botUsername, payload)
  return `https://t.me/${botUsername}/${shortName}?startapp=${payload}`
}

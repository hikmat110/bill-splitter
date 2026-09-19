/**
 * Renders the two group messages: the Join card while a split is collecting,
 * and the payment board once a bill exists.
 *
 * Takes plain data plus a translate function rather than a grammy Context, so
 * it stays pure and unit-testable — the same reason buildSupportCaption lives
 * outside its handler.
 *
 * Everything here goes out as Telegram HTML, and every name originates from a
 * Telegram profile, i.e. from a stranger. Escaping is therefore not cosmetic:
 * a member called `<b` would otherwise break the parse and fail the send.
 */

import type { I18nKey } from '../i18n'
import { formatMoney } from './format'

export type Translate = (key: I18nKey, vars?: Record<string, string>) => string

/** Longest roster we print in full before collapsing the tail into "…and N more". */
export const ROSTER_LIMIT = 25

export interface RosterMember {
  telegramId: string
  displayName: string
  username: string | null
  /** False until they start the bot — they cannot be DM'd their share yet. */
  isRegistered: boolean
  isHost: boolean
}

export interface SplitCardView {
  title: string
  hostName: string
  members: RosterMember[]
  hasReceipt: boolean
  status: string
}

export type ParticipantStatus = 'pending' | 'marked_paid' | 'confirmed' | 'disputed'

export interface BoardParticipant {
  displayName: string
  telegramId: string | null
  username: string | null
  amount: number
  status: ParticipantStatus
  /** The creator never owes themselves — see the self-participant invariant. */
  isHost: boolean
}

export interface PaymentBoardView {
  title: string
  total: number
  hostName: string
  participants: BoardParticipant[]
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Clickable profile link that works for people with no @username. */
export function userLink(telegramId: string, displayName: string): string {
  return `<a href="tg://user?id=${escapeHtml(telegramId)}">${escapeHtml(displayName)}</a>`
}

/**
 * Roster entries are decorative, so they always render as a profile link: it
 * shows the person's real name and stays clickable without a username.
 */
function rosterName(m: RosterMember): string {
  return userLink(m.telegramId, m.displayName)
}

/**
 * Reminders must actually notify, and only a literal @username is guaranteed
 * to — a tg://user link notifies only when the client already knows the user.
 * So here, unlike the roster, @username wins when there is one.
 */
export function mentionFor(p: {
  telegramId: string | null
  displayName: string
  username: string | null
}): string {
  if (p.username) return `@${escapeHtml(p.username)}`
  if (p.telegramId) return userLink(p.telegramId, p.displayName)
  return escapeHtml(p.displayName)
}

export function renderSplitCard(view: SplitCardView, tr: Translate): string {
  const lines: string[] = [
    tr('group.card.header', {
      title: escapeHtml(view.title),
      host: escapeHtml(view.hostName),
    }),
  ]

  if (view.status === 'cancelled') {
    lines.push('', tr('group.card.cancelled'))
    return lines.join('\n')
  }
  if (view.status === 'expired') {
    lines.push('', tr('group.card.expired'))
    return lines.join('\n')
  }

  lines.push(
    view.status === 'building'
      ? tr('group.card.building', { host: escapeHtml(view.hostName) })
      : tr('group.card.hint')
  )

  if (view.status === 'collecting') {
    lines.push(
      view.hasReceipt ? tr('group.card.receipt_attached') : tr('group.card.receipt_hint')
    )
  } else if (view.hasReceipt) {
    lines.push(tr('group.card.receipt_attached'))
  }

  lines.push('')

  if (view.members.length === 0) {
    lines.push(tr('group.card.empty'))
    return lines.join('\n')
  }

  lines.push(tr('group.card.joined', { count: String(view.members.length) }))

  const shown = view.members.slice(0, ROSTER_LIMIT)
  shown.forEach((m, i) => {
    const tags: string[] = []
    if (m.isHost) tags.push(tr('group.card.host_tag'))
    if (!m.isRegistered) tags.push(tr('group.card.new_tag'))
    const suffix = tags.length ? ` · ${tags.join(' · ')}` : ''
    lines.push(`${i + 1}. ${rosterName(m)}${suffix}`)
  })

  const hidden = view.members.length - shown.length
  if (hidden > 0) lines.push(tr('group.card.more', { count: String(hidden) }))

  return lines.join('\n')
}

const GLYPH: Record<ParticipantStatus, string> = {
  confirmed: '✅',
  marked_paid: '💸',
  pending: '⏳',
  disputed: '⚠️',
}

export function renderPaymentBoard(view: PaymentBoardView, tr: Translate): string {
  // The host is the one collecting, so they never appear in the owe list.
  const owing = view.participants.filter((p) => !p.isHost)

  const lines: string[] = [
    tr('group.board.header', {
      title: escapeHtml(view.title),
      total: formatMoney(view.total),
    }),
    tr('group.board.host', { host: escapeHtml(view.hostName) }),
    '',
  ]

  const shown = owing.slice(0, ROSTER_LIMIT)
  for (const p of shown) {
    const note =
      p.status === 'marked_paid'
        ? ` · ${tr('group.board.awaiting', { host: escapeHtml(view.hostName) })}`
        : ''
    lines.push(
      `${GLYPH[p.status]} ${escapeHtml(p.displayName)} — ${formatMoney(p.amount)}${note}`
    )
  }
  const hidden = owing.length - shown.length
  if (hidden > 0) lines.push(tr('group.card.more', { count: String(hidden) }))

  const settled = owing.filter((p) => p.status === 'confirmed').length
  const left = owing
    .filter((p) => p.status !== 'confirmed')
    .reduce((sum, p) => sum + p.amount, 0)

  lines.push('')
  lines.push(
    settled === owing.length && owing.length > 0
      ? tr('group.board.all_settled')
      : tr('group.board.summary', {
          paid: String(settled),
          count: String(owing.length),
          left: formatMoney(left),
        })
  )

  return lines.join('\n')
}

/** One reminder message naming everyone who still owes, so it notifies once. */
export function renderRemindText(participants: BoardParticipant[], tr: Translate): string {
  const names = participants
    .filter((p) => !p.isHost && p.status !== 'confirmed')
    .map(mentionFor)
  return tr('group.board.remind_text', { names: names.join(', ') })
}

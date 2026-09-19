import { describe, it, expect } from 'bun:test'
import {
  escapeHtml,
  userLink,
  mentionFor,
  renderSplitCard,
  renderPaymentBoard,
  renderRemindText,
  ROSTER_LIMIT,
  type RosterMember,
  type BoardParticipant,
} from './board-render'
import { formatMoney } from './format'

/** Stand-in for t(): echoes the key plus its vars, so assertions stay about
 *  structure and escaping rather than about any particular translation. */
const tr = (key: string, vars?: Record<string, string>) =>
  vars ? `${key}(${Object.entries(vars).map(([k, v]) => `${k}=${v}`).join(',')})` : key

const member = (over: Partial<RosterMember> = {}): RosterMember => ({
  telegramId: '101',
  displayName: 'Aziz',
  username: null,
  isRegistered: true,
  isHost: false,
  ...over,
})

const participant = (over: Partial<BoardParticipant> = {}): BoardParticipant => ({
  displayName: 'Aziz',
  telegramId: '101',
  username: null,
  amount: 105000,
  status: 'pending',
  isHost: false,
  ...over,
})

describe('escapeHtml', () => {
  it('escapes every character that could break Telegram HTML', () => {
    expect(escapeHtml('<b>A & "B"</b>')).toBe('&lt;b&gt;A &amp; &quot;B&quot;&lt;/b&gt;')
  })

  it('escapes the ampersand first so entities are not double-built', () => {
    expect(escapeHtml('&lt;')).toBe('&amp;lt;')
  })
})

describe('userLink', () => {
  it('escapes the display name inside the anchor', () => {
    // Names come from Telegram profiles, i.e. from strangers. An unescaped
    // "<b" here would break the parse and fail the whole send.
    expect(userLink('7', '<b')).toBe('<a href="tg://user?id=7">&lt;b</a>')
  })
})

describe('mentionFor', () => {
  it('prefers @username, which is what actually notifies', () => {
    expect(mentionFor({ telegramId: '7', displayName: 'Aziz', username: 'aziz_k' })).toBe('@aziz_k')
  })

  it('falls back to a profile link when there is no username', () => {
    expect(mentionFor({ telegramId: '7', displayName: 'Aziz', username: null })).toBe(
      '<a href="tg://user?id=7">Aziz</a>'
    )
  })

  it('degrades to a bare escaped name when there is no id either', () => {
    expect(mentionFor({ telegramId: null, displayName: 'A<b', username: null })).toBe('A&lt;b')
  })
})

describe('renderSplitCard', () => {
  const base = {
    title: 'Dinner',
    hostName: 'Aziz',
    hasReceipt: false,
    status: 'collecting',
  }

  it('numbers the roster and tags the host and newcomers', () => {
    const out = renderSplitCard(
      {
        ...base,
        members: [
          member({ displayName: 'Aziz', isHost: true }),
          member({ telegramId: '102', displayName: 'Madina', isRegistered: false }),
        ],
      },
      tr
    )
    expect(out).toContain('1. <a href="tg://user?id=101">Aziz</a> · group.card.host_tag')
    expect(out).toContain('2. <a href="tg://user?id=102">Madina</a> · group.card.new_tag')
    expect(out).toContain('group.card.joined(count=2)')
  })

  it('escapes a hostile display name', () => {
    const out = renderSplitCard({ ...base, members: [member({ displayName: '<i>x' })] }, tr)
    expect(out).toContain('&lt;i&gt;x')
    expect(out).not.toContain('<i>x')
  })

  it('says so when nobody has joined', () => {
    const out = renderSplitCard({ ...base, members: [] }, tr)
    expect(out).toContain('group.card.empty')
  })

  it('swaps the receipt hint once a receipt is attached', () => {
    expect(renderSplitCard({ ...base, members: [] }, tr)).toContain('group.card.receipt_hint')
    expect(renderSplitCard({ ...base, hasReceipt: true, members: [] }, tr)).toContain(
      'group.card.receipt_attached'
    )
  })

  it('collapses a long roster instead of risking the 4096-char limit', () => {
    const members = Array.from({ length: 200 }, (_, i) =>
      member({ telegramId: String(i), displayName: `Member ${i}` })
    )
    const out = renderSplitCard({ ...base, members }, tr)
    expect(out).toContain(`group.card.more(count=${200 - ROSTER_LIMIT})`)
    expect(out.length).toBeLessThan(4096)
  })

  it('renders terminal states as a single line', () => {
    for (const status of ['cancelled', 'expired']) {
      const out = renderSplitCard({ ...base, status, members: [member()] }, tr)
      expect(out).toContain(`group.card.${status}`)
      expect(out).not.toContain('group.card.joined')
    }
  })
})

describe('renderPaymentBoard', () => {
  const base = { title: 'Dinner', total: 420000, hostName: 'Aziz' }

  it('omits the host from the owe list and the counts', () => {
    // The creator never owes themselves — the self-participant invariant.
    const out = renderPaymentBoard(
      {
        ...base,
        participants: [
          participant({ displayName: 'Aziz', isHost: true, amount: 105000 }),
          participant({ displayName: 'Madina', status: 'confirmed' }),
          participant({ displayName: 'Sardor' }),
        ],
      },
      tr
    )
    expect(out).not.toContain('✅ Aziz')
    // formatMoney groups thousands with a non-breaking space, so assert on the
    // counts and let formatMoney's own tests cover the money formatting.
    expect(out).toContain('group.board.summary(paid=1,count=2,left=')
    expect(out).toContain(formatMoney(105000))
  })

  it('uses a distinct glyph per status and flags awaiting confirmation', () => {
    const out = renderPaymentBoard(
      {
        ...base,
        participants: [
          participant({ displayName: 'A', status: 'confirmed' }),
          participant({ displayName: 'B', status: 'marked_paid' }),
          participant({ displayName: 'C', status: 'pending' }),
          participant({ displayName: 'D', status: 'disputed' }),
        ],
      },
      tr
    )
    expect(out).toContain('✅ A')
    expect(out).toContain('💸 B')
    expect(out).toContain('⏳ C')
    expect(out).toContain('⚠️ D')
    expect(out).toContain('group.board.awaiting(host=Aziz)')
  })

  it('celebrates once everyone has confirmed', () => {
    const out = renderPaymentBoard(
      { ...base, participants: [participant({ status: 'confirmed' })] },
      tr
    )
    expect(out).toContain('group.board.all_settled')
  })

  it('escapes participant names', () => {
    const out = renderPaymentBoard(
      { ...base, participants: [participant({ displayName: '<script>' })] },
      tr
    )
    expect(out).toContain('&lt;script&gt;')
    expect(out).not.toContain('<script>')
  })
})

describe('renderRemindText', () => {
  it('names only the people who still owe', () => {
    const out = renderRemindText(
      [
        participant({ displayName: 'Aziz', isHost: true }),
        participant({ displayName: 'Madina', status: 'confirmed' }),
        participant({ displayName: 'Sardor', username: 'sardor' }),
        participant({ displayName: 'Nodir', telegramId: '9' }),
      ],
      tr
    )
    expect(out).toContain('@sardor')
    expect(out).toContain('<a href="tg://user?id=9">Nodir</a>')
    expect(out).not.toContain('Madina')
    expect(out).not.toContain('Aziz')
  })
})

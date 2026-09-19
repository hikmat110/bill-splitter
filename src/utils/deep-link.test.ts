import { describe, it, expect } from 'bun:test'
import {
  parseStartPayload,
  buildSplitPayload,
  startLink,
  miniAppLink,
  MAX_PAYLOAD_LENGTH,
} from './deep-link'

const UUID = '3f1b9c2e-7a4d-4f8b-9c1e-2d5a6b7c8d9e'

describe('parseStartPayload', () => {
  it('still recognises the pre-existing add_contacts link', () => {
    // Emitted by webapp AddContactSheet — must not regress.
    expect(parseStartPayload('add_contacts')).toEqual({ kind: 'add_contacts' })
  })

  it('parses a group split payload', () => {
    expect(parseStartPayload(`gs_${UUID}`)).toEqual({ kind: 'group_split', splitId: UUID })
  })

  it('treats anything unrecognised as none', () => {
    for (const bad of [
      undefined,
      null,
      '',
      'gs_',
      'gs_notauuid',
      `gs_${UUID}x`,
      'add_contacts_x',
      'bill:123',
      '../../etc/passwd',
      'a'.repeat(100),
      `gs_${UUID}`.padEnd(MAX_PAYLOAD_LENGTH + 1, 'z'),
    ]) {
      expect(parseStartPayload(bad)).toEqual({ kind: 'none' })
    }
  })
})

describe('buildSplitPayload', () => {
  it('fits Telegram’s payload budget and character set', () => {
    const payload = buildSplitPayload(UUID)
    expect(payload.length).toBeLessThanOrEqual(MAX_PAYLOAD_LENGTH)
    expect(payload).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('round-trips through the parser', () => {
    expect(parseStartPayload(buildSplitPayload(UUID))).toEqual({
      kind: 'group_split',
      splitId: UUID,
    })
  })
})

describe('link builders', () => {
  it('builds a private-chat start link', () => {
    expect(startLink('SplitBot', 'gs_1')).toBe('https://t.me/SplitBot?start=gs_1')
  })

  it('prefers a direct-link Mini App when a short name is configured', () => {
    expect(miniAppLink('SplitBot', 'app', 'gs_1')).toBe('https://t.me/SplitBot/app?startapp=gs_1')
  })

  it('falls back to the private-chat bounce without a short name', () => {
    // The feature must work before anyone runs /newapp in BotFather.
    expect(miniAppLink('SplitBot', undefined, 'gs_1')).toBe('https://t.me/SplitBot?start=gs_1')
  })
})

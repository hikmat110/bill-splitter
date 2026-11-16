import { describe, it, expect } from 'bun:test'
import {
  decideSplitStart,
  canPressSplitAction,
  SPLIT_TTL_MS,
  type OpenSplitLike,
} from './group-split'

const NOW = new Date('2026-09-19T12:00:00Z')
const HOST = 'user-host'
const OTHER = 'user-other'

const split = (over: Partial<OpenSplitLike> = {}): OpenSplitLike => ({
  id: 'split-1',
  creator_id: HOST,
  status: 'collecting',
  updated_at: NOW,
  ...over,
})

describe('decideSplitStart', () => {
  it('creates when nothing is open', () => {
    expect(decideSplitStart(null, HOST, NOW)).toEqual({ action: 'create' })
  })

  it('creates when the existing split is already finished', () => {
    for (const status of ['sent', 'cancelled', 'expired']) {
      expect(decideSplitStart(split({ status }), OTHER, NOW)).toEqual({ action: 'create' })
    }
  })

  it('replaces a fresh split when its own creator asks again', () => {
    expect(decideSplitStart(split(), HOST, NOW)).toEqual({
      action: 'expire_and_create',
      splitId: 'split-1',
    })
  })

  it('points a different member at the card that is already open', () => {
    expect(decideSplitStart(split(), OTHER, NOW)).toEqual({
      action: 'reuse',
      splitId: 'split-1',
    })
  })

  it('expires a stale card so it cannot hold the chat hostage', () => {
    // No cron expires abandoned splits; the next /split has to do it, or the
    // partial unique index blocks the chat forever.
    const stale = split({ updated_at: new Date(NOW.getTime() - SPLIT_TTL_MS - 1) })
    expect(decideSplitStart(stale, OTHER, NOW)).toEqual({
      action: 'expire_and_create',
      splitId: 'split-1',
    })
  })

  it('keeps reusing right up to the TTL boundary', () => {
    const edge = split({ updated_at: new Date(NOW.getTime() - SPLIT_TTL_MS) })
    expect(decideSplitStart(edge, OTHER, NOW)).toEqual({ action: 'reuse', splitId: 'split-1' })
  })
})

describe('canPressSplitAction', () => {
  it('lets anyone join or leave while collecting', () => {
    expect(canPressSplitAction('join', { status: 'collecting' }, false)).toEqual({ ok: true })
    expect(canPressSplitAction('leave', { status: 'collecting' }, false)).toEqual({ ok: true })
  })

  it('freezes the roster once the creator starts building', () => {
    for (const status of ['building', 'sent', 'cancelled', 'expired']) {
      expect(canPressSplitAction('join', { status }, false)).toEqual({
        ok: false,
        reason: 'closed',
      })
    }
  })

  it('allows only the creator to cancel', () => {
    expect(canPressSplitAction('cancel', { status: 'collecting' }, true)).toEqual({ ok: true })
    expect(canPressSplitAction('cancel', { status: 'building' }, true)).toEqual({ ok: true })
    expect(canPressSplitAction('cancel', { status: 'collecting' }, false)).toEqual({
      ok: false,
      reason: 'not_creator',
    })
  })

  it('reports a finished split as closed even to its creator', () => {
    expect(canPressSplitAction('cancel', { status: 'sent' }, true)).toEqual({
      ok: false,
      reason: 'closed',
    })
  })
})

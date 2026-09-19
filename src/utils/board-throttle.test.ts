import { describe, it, expect } from 'bun:test'
import { decideBoardEdit, BOARD_MIN_INTERVAL_MS } from './board-throttle'

const T = 1_000_000

describe('decideBoardEdit', () => {
  it('edits immediately when the board has never been drawn', () => {
    expect(decideBoardEdit(null, null, T)).toEqual({ action: 'edit' })
  })

  it('schedules the remainder when an edit is too recent', () => {
    expect(decideBoardEdit(T, null, T + 500)).toEqual({
      action: 'schedule',
      inMs: BOARD_MIN_INTERVAL_MS - 500,
    })
  })

  it('skips while an edit is already queued', () => {
    // Ten joins in five seconds collapse to the one scheduled edit, which will
    // read fresh state when it fires.
    expect(decideBoardEdit(T, T + 500, T + 600)).toEqual({ action: 'skip' })
  })

  it('edits again once the interval has fully elapsed', () => {
    expect(decideBoardEdit(T, null, T + BOARD_MIN_INTERVAL_MS)).toEqual({ action: 'edit' })
    expect(decideBoardEdit(T, null, T + BOARD_MIN_INTERVAL_MS + 1)).toEqual({ action: 'edit' })
  })

  it('honours a caller-supplied interval', () => {
    expect(decideBoardEdit(T, null, T + 100, 10_000)).toEqual({
      action: 'schedule',
      inMs: 9_900,
    })
  })
})

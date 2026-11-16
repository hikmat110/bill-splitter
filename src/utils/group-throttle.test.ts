import { describe, it, expect } from 'bun:test'
import { shouldReplyAgain, ReplyThrottle } from './group-throttle'

describe('shouldReplyAgain', () => {
  it('allows a first reply', () => {
    expect(shouldReplyAgain(null, 1000, 500)).toBe(true)
    expect(shouldReplyAgain(undefined, 1000, 500)).toBe(true)
  })

  it('blocks inside the window and allows on the boundary', () => {
    expect(shouldReplyAgain(1000, 1499, 500)).toBe(false)
    expect(shouldReplyAgain(1000, 1500, 500)).toBe(true)
  })
})

describe('ReplyThrottle', () => {
  it('lets the first take through and blocks the rest of the window', () => {
    const throttle = new ReplyThrottle(1000)
    expect(throttle.take('chat:user', 0)).toBe(true)
    expect(throttle.take('chat:user', 500)).toBe(false)
    expect(throttle.take('chat:user', 1000)).toBe(true)
  })

  it('tracks keys independently', () => {
    const throttle = new ReplyThrottle(1000)
    expect(throttle.take('a', 0)).toBe(true)
    expect(throttle.take('b', 0)).toBe(true)
    expect(throttle.take('a', 100)).toBe(false)
  })

  it('drops expired entries so it cannot grow without bound', () => {
    const throttle = new ReplyThrottle(1000)
    for (let i = 0; i < 100; i++) throttle.take(`chat-${i}`, i)
    // Far past every window: the next write prunes all of them.
    expect(throttle.take('fresh', 10_000)).toBe(true)
    expect((throttle as unknown as { seen: Map<string, number> }).seen.size).toBe(1)
  })
})

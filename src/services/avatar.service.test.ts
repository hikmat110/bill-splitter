import { describe, expect, test } from 'bun:test'
import { pickAvatarSize } from './avatar.service'
import type { PhotoSize } from 'grammy/types'

const size = (width: number, height = width, i = 0): PhotoSize => ({
  file_id: `f${width}-${i}`,
  file_unique_id: `u${width}-${i}`,
  width,
  height,
})

describe('pickAvatarSize', () => {
  test('picks the smallest size of at least 160px', () => {
    expect(pickAvatarSize([size(160), size(320), size(640)])?.width).toBe(160)
    expect(pickAvatarSize([size(640), size(320), size(161)])?.width).toBe(161) // order-independent
  })

  test('falls back to the largest when everything is below 160px', () => {
    expect(pickAvatarSize([size(40), size(90), size(120)])?.width).toBe(120)
  })

  test('returns null for an empty list', () => {
    expect(pickAvatarSize([])).toBeNull()
  })
})

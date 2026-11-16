import { describe, it, expect } from 'bun:test'
import { buildFeedbackCaption, buildSupportCaption } from './notification.service'
import type { FeedbackCaptionInput, SupportCaptionInput } from './notification.service'

const base: FeedbackCaptionInput = {
  category: 'bug',
  message: 'The total is wrong on my last bill',
  screen: 'bill_detail',
  buildId: '0.1.0+64070b7',
  platform: 'ios',
  tgVersion: '8.0',
  language: 'ru',
  reporter: {
    first_name: 'Aziz',
    last_name: 'Karimov',
    username: 'azizk',
    telegram_id: 123456789n,
  },
  attachmentCount: 1,
}

describe('buildFeedbackCaption', () => {
  it('includes header, reporter, message and context', () => {
    const caption = buildFeedbackCaption(base)
    expect(caption).toContain('🐞 Bug report')
    expect(caption).toContain('From: Aziz Karimov · @azizk · id 123456789')
    expect(caption).toContain('The total is wrong on my last bill')
    expect(caption).toContain('bill_detail · 0.1.0+64070b7 · ios 8.0 · ru')
    expect(caption).not.toContain('more photo')
  })

  it('omits missing reporter fields and notes extra photos', () => {
    const caption = buildFeedbackCaption({
      ...base,
      category: 'suggestion',
      reporter: { ...base.reporter, last_name: null, username: null },
      attachmentCount: 3,
    })
    expect(caption).toContain('💡 Suggestion')
    expect(caption).toContain('From: Aziz · id 123456789')
    expect(caption).toContain('+2 more photo(s)')
  })

  it('truncates long messages to fit the 1024-char photo caption', () => {
    const caption = buildFeedbackCaption({ ...base, message: 'x'.repeat(2000) })
    expect(caption.length).toBeLessThanOrEqual(1024)
    expect(caption).toContain('…')
    // Context survives truncation — only the message is cut.
    expect(caption).toContain('bill_detail · 0.1.0+64070b7 · ios 8.0 · ru')
  })

  it('falls back to the generic header for unknown categories', () => {
    expect(buildFeedbackCaption({ ...base, category: 'other' })).toContain('💬 Feedback')
  })
})

const supportBase: SupportCaptionInput = {
  message: 'I paid but it still says pending',
  sender: {
    first_name: 'Aziz',
    last_name: 'Karimov',
    username: 'azizk',
    telegram_id: 123456789n,
  },
  hasPhoto: false,
}

describe('buildSupportCaption', () => {
  it('includes the header, sender, message and where to reply', () => {
    const caption = buildSupportCaption(supportBase)
    expect(caption).toContain('📨 Support message')
    expect(caption).toContain('From: Aziz Karimov · @azizk · id 123456789')
    expect(caption).toContain('I paid but it still says pending')
    expect(caption).toContain('Support inbox')
  })

  it('omits missing sender fields', () => {
    const caption = buildSupportCaption({
      ...supportBase,
      sender: { ...supportBase.sender, last_name: null, username: null },
    })
    expect(caption).toContain('From: Aziz · id 123456789')
  })

  it('labels a photo sent with no caption', () => {
    const caption = buildSupportCaption({ ...supportBase, message: '', hasPhoto: true })
    expect(caption).toContain('(photo)')
  })

  it('leaves an empty body when there is nothing to show', () => {
    const caption = buildSupportCaption({ ...supportBase, message: '   ', hasPhoto: false })
    expect(caption).not.toContain('(photo)')
    expect(caption).toContain('📨 Support message')
  })

  it('truncates a long message to fit the caption limit', () => {
    const caption = buildSupportCaption({ ...supportBase, message: 'x'.repeat(2000) })
    expect(caption.length).toBeLessThanOrEqual(1024)
    expect(caption).toContain('…')
    expect(caption).toContain('Support inbox')
  })
})

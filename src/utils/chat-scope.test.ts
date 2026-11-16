import { describe, it, expect } from 'bun:test'
import {
  isPrivateChat,
  isGroupChat,
  isAnonymousSender,
  isReplyToBot,
  isBoardReply,
  isBotCommandMessage,
} from './chat-scope'

const BOT_ID = 777

describe('isPrivateChat / isGroupChat', () => {
  it('classifies each chat type', () => {
    expect(isPrivateChat({ id: 1, type: 'private' })).toBe(true)
    expect(isPrivateChat({ id: -1, type: 'supergroup' })).toBe(false)
    expect(isGroupChat({ id: -1, type: 'group' })).toBe(true)
    expect(isGroupChat({ id: -1, type: 'supergroup' })).toBe(true)
    expect(isGroupChat({ id: 1, type: 'private' })).toBe(false)
    // Channels are supported by neither — the bot has no channel story.
    expect(isGroupChat({ id: -1, type: 'channel' })).toBe(false)
    expect(isPrivateChat({ id: -1, type: 'channel' })).toBe(false)
  })

  it('treats a missing chat as neither', () => {
    expect(isPrivateChat(undefined)).toBe(false)
    expect(isGroupChat(undefined)).toBe(false)
  })
})

describe('isAnonymousSender', () => {
  it('accepts an ordinary human sender', () => {
    expect(isAnonymousSender({ from: { id: 42, is_bot: false } })).toBe(false)
  })

  it('rejects other bots', () => {
    expect(isAnonymousSender({ from: { id: 42, is_bot: true } })).toBe(true)
  })

  it('rejects anonymous admins and channel senders', () => {
    expect(isAnonymousSender({ from: { id: 1087968824 }, senderChat: { id: -100 } })).toBe(true)
  })

  it('rejects an update with no sender at all', () => {
    expect(isAnonymousSender({})).toBe(true)
  })
})

describe('isReplyToBot', () => {
  it('is true only when the reply target came from the bot', () => {
    expect(isReplyToBot({ reply_to_message: { message_id: 5, from: { id: BOT_ID } } }, BOT_ID)).toBe(true)
    expect(isReplyToBot({ reply_to_message: { message_id: 5, from: { id: 9 } } }, BOT_ID)).toBe(false)
  })

  it('is false for a message that replies to nothing', () => {
    expect(isReplyToBot({ message_id: 3 }, BOT_ID)).toBe(false)
    expect(isReplyToBot(undefined, BOT_ID)).toBe(false)
  })
})

describe('isBoardReply', () => {
  const reply = (id: number, fromId: number) => ({
    reply_to_message: { message_id: id, from: { id: fromId } },
  })

  it('matches a reply to that exact bot message', () => {
    expect(isBoardReply(reply(5, BOT_ID), BOT_ID, 5)).toBe(true)
  })

  it('rejects a reply to a different bot message', () => {
    // e.g. an old board, or an error message — must not be read as a receipt.
    expect(isBoardReply(reply(4, BOT_ID), BOT_ID, 5)).toBe(false)
  })

  it('rejects a reply to another user, even with the same message id', () => {
    expect(isBoardReply(reply(5, 9), BOT_ID, 5)).toBe(false)
  })

  it('rejects when there is no board to reply to', () => {
    expect(isBoardReply(reply(5, BOT_ID), BOT_ID, null)).toBe(false)
    expect(isBoardReply(reply(5, BOT_ID), BOT_ID, undefined)).toBe(false)
  })
})

describe('isBotCommandMessage', () => {
  it('recognises a message that starts with a command', () => {
    expect(
      isBotCommandMessage({ entities: [{ type: 'bot_command', offset: 0 }] })
    ).toBe(true)
  })

  it('ignores a command mentioned mid-sentence', () => {
    // "ask the bot with /split" is chatter about the bot, not a command to it.
    expect(
      isBotCommandMessage({ entities: [{ type: 'bot_command', offset: 9 }] })
    ).toBe(false)
  })

  it('ignores other entity types and plain messages', () => {
    expect(isBotCommandMessage({ entities: [{ type: 'mention', offset: 0 }] })).toBe(false)
    expect(isBotCommandMessage({ message_id: 1 })).toBe(false)
    expect(isBotCommandMessage(undefined)).toBe(false)
  })
})

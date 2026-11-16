// Chat-scope predicates: the single place that answers "may the bot speak here,
// and was this message actually addressed to us?".
//
// Pure and structural (no grammy import) so it is unit-testable with plain
// objects — same grain as utils/telegram-errors.
//
// Background: the bot was private-chat-only until groups were added. In a group
// it must stay silent unless spoken to, so every group handler gates on these
// predicates rather than re-deriving the rule inline.

/** Chat types the bot is willing to operate in. Channels are not among them. */
export type SupportedChatType = 'private' | 'group' | 'supergroup'

export interface ChatLike {
  id: number
  type: string
}

export interface SenderLike {
  id: number
  is_bot?: boolean
}

export interface MessageEntityLike {
  type: string
  offset: number
}

export interface MessageLike {
  message_id?: number
  entities?: MessageEntityLike[]
  from?: SenderLike
  /** Present when an anonymous admin or a linked channel posted the message. */
  sender_chat?: unknown
  reply_to_message?: { message_id?: number; from?: SenderLike } | undefined
}

export function isPrivateChat(chat: ChatLike | undefined): boolean {
  return chat?.type === 'private'
}

export function isGroupChat(chat: ChatLike | undefined): boolean {
  return chat?.type === 'group' || chat?.type === 'supergroup'
}

/**
 * True for senders that have no usable personal identity: other bots, and
 * anonymous admins / channel senders (Telegram reports those as the shared
 * GroupAnonymousBot with a meaningless `from.id`, carrying `sender_chat`).
 * Such senders can never be DM'd, so they can never be contacts or
 * participants — every group flow drops them up front.
 */
export function isAnonymousSender(update: {
  from?: SenderLike
  senderChat?: unknown
}): boolean {
  if (!update.from) return true
  if (update.from.is_bot) return true
  return update.senderChat !== undefined && update.senderChat !== null
}

/**
 * True when the message is a reply to one of the bot's own messages. With
 * Telegram privacy mode on, such a reply is delivered even when it carries no
 * command and no caption — which is what makes "reply to my card with the
 * receipt photo" a reliable group flow.
 */
export function isReplyToBot(msg: MessageLike | undefined, botId: number): boolean {
  return msg?.reply_to_message?.from?.id === botId
}

/**
 * True when the message replies to one specific bot message — the split card.
 * Stricter than isReplyToBot: a reply to some other bot message (an old board,
 * an error) must not be mistaken for a receipt upload.
 */
export function isBoardReply(
  msg: MessageLike | undefined,
  botId: number,
  boardMessageId: number | null | undefined
): boolean {
  if (boardMessageId === null || boardMessageId === undefined) return false
  if (!isReplyToBot(msg, botId)) return false
  return msg?.reply_to_message?.message_id === boardMessageId
}

/**
 * True when the message IS a command, i.e. it starts with one.
 *
 * A command is explicitly addressed to the bot, so answering it — including
 * answering it with an error — is a direct reply rather than unsolicited noise.
 * Without this distinction a failing /split in a group is indistinguishable
 * from a /split that was never wired up: both are silence.
 */
export function isBotCommandMessage(msg: MessageLike | undefined): boolean {
  const entities = msg?.entities
  if (!Array.isArray(entities)) return false
  return entities.some((e) => e.type === 'bot_command' && e.offset === 0)
}

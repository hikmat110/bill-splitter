import { InlineKeyboard, Keyboard } from 'grammy'
import type { MyContext } from '../index'
import { t } from '../../i18n'
import {
  listContacts,
  findContactById,
  addContact,
  addLinkedContactsBatch,
  addContactsByUsernames,
  isContactReferencedInBills,
  deleteContact,
  type BatchPerson,
  type BatchResult,
  type UsernameAddResult,
} from '../../services/contact.service'
import { findByTelegramIds } from '../../services/user.service'
import { parseUsernameList } from '../../utils/username'

/** Fixed request_id for the multi-select user picker (only one active at a time). */
const PICK_REQUEST_ID = 1
import {
  contactListKeyboard,
  contactDetailKeyboard,
  contactSkipPhoneKeyboard,
  contactAddSourceKeyboard,
} from '../keyboards'
import { encode } from '../../utils/callback'
import { showMainMenu } from './menu'

export async function contactsMenuHandler(ctx: MyContext): Promise<void> {
  const contacts = await listContacts(ctx.user.id)
  const text = contacts.length === 0
    ? t(ctx, 'contacts.empty')
    : t(ctx, 'contacts.list_title', { count: String(contacts.length) })

  await editContactMessage(ctx, text, contactListKeyboard(contacts, ctx))
}

export async function contactAddStartHandler(ctx: MyContext): Promise<void> {
  const msgId = ctx.callbackQuery?.message?.message_id ?? ctx.session.mainMessageId
  ctx.session.contact_wizard = { step: 'awaiting_contact_source', wizardMessageId: msgId }
  await editContactWizardMessage(ctx, t(ctx, 'contacts.add_source'), contactAddSourceKeyboard(ctx))
}

export async function contactStartManualHandler(ctx: MyContext): Promise<void> {
  if (!ctx.session.contact_wizard) {
    const msgId = ctx.callbackQuery?.message?.message_id ?? ctx.session.mainMessageId
    ctx.session.contact_wizard = { step: 'awaiting_name', wizardMessageId: msgId }
  } else {
    ctx.session.contact_wizard.step = 'awaiting_name'
  }
  await editContactWizardMessage(ctx, t(ctx, 'contacts.add_name_prompt'))
}

export async function contactStartTelegramHandler(ctx: MyContext): Promise<void> {
  const msgId = ctx.callbackQuery?.message?.message_id ?? ctx.session.mainMessageId
  ctx.session.contact_wizard = { step: 'awaiting_users_share', wizardMessageId: msgId }

  const cancelKeyboard = new InlineKeyboard()
    .text(t(ctx, 'contacts.cancel_share'), encode('contact', 'cancel', 'now'))
  await editContactWizardMessage(ctx, t(ctx, 'contacts.pick_prompt'), cancelKeyboard)

  // The native multi-select picker lives on a reply keyboard, which must ride on
  // its own carrier message; we delete that message once a selection comes back.
  const pickKeyboard = new Keyboard()
    .requestUsers(t(ctx, 'contacts.pick_button'), PICK_REQUEST_ID, {
      max_quantity: 10,
      user_is_bot: false,
      request_name: true,
      request_username: true,
    })
    .resized()
    .oneTime()

  const sent = await ctx.reply(t(ctx, 'contacts.pick_hint'), { reply_markup: pickKeyboard })
  if (ctx.session.contact_wizard) ctx.session.contact_wizard.pickerMessageId = sent.message_id
}

export async function contactStartUsernameHandler(ctx: MyContext): Promise<void> {
  const msgId = ctx.callbackQuery?.message?.message_id ?? ctx.session.mainMessageId
  ctx.session.contact_wizard = { step: 'awaiting_username', wizardMessageId: msgId }

  const cancelKeyboard = new InlineKeyboard()
    .text(t(ctx, 'contacts.cancel_share'), encode('contact', 'cancel', 'now'))

  await editContactWizardMessage(ctx, t(ctx, 'contacts.username_prompt'), cancelKeyboard)
}

/** Called when the user picks people via the native multi-select (`request_users`). */
export async function usersSharedHandler(ctx: MyContext): Promise<void> {
  const wizard = ctx.session.contact_wizard
  const shared = ctx.message?.users_shared

  if (!shared || wizard?.step !== 'awaiting_users_share') return

  const msgId = wizard.wizardMessageId
  const pickerMsgId = wizard.pickerMessageId
  ctx.session.contact_wizard = undefined

  // Clean up the hidden service message and the reply-keyboard carrier message
  await ctx.deleteMessage().catch(() => undefined)
  if (pickerMsgId && ctx.chat) {
    await ctx.api.deleteMessage(ctx.chat.id, pickerMsgId).catch(() => undefined)
  }

  const picked = shared.users.filter((u) => u.user_id !== ctx.from?.id)
  if (picked.length === 0) {
    await editContactWizardMessageById(ctx, msgId, t(ctx, 'contacts.pick_none'))
    await showContactListById(ctx, msgId)
    return
  }

  // Resolve which picks are already registered, to link them and use their real names
  const registered = await findByTelegramIds(picked.map((u) => BigInt(u.user_id)))
  const byTgId = new Map(registered.map((u) => [u.telegram_id, u]))

  const people: BatchPerson[] = picked.map((u) => {
    const reg = byTgId.get(BigInt(u.user_id))
    const fromShare = [u.first_name, u.last_name].filter(Boolean).join(' ')
    const displayName =
      (reg ? [reg.first_name, reg.last_name].filter(Boolean).join(' ') : fromShare) ||
      (u.username ? `@${u.username}` : '') ||
      `User ${u.user_id}`
    return reg
      ? { userId: reg.id, phone: reg.phone, displayName }
      : { telegramId: BigInt(u.user_id), displayName }
  })

  try {
    const result = await addLinkedContactsBatch(ctx.user.id, people)
    await editContactWizardMessageById(ctx, msgId, formatBatchResult(ctx, result))
  } catch (err) {
    ctx.logger.error({ err }, 'addLinkedContactsBatch (picker) failed')
    await editContactWizardMessageById(ctx, msgId, t(ctx, 'errors.generic'))
  }
  await showContactListById(ctx, msgId)
}

export async function contactTextHandler(ctx: MyContext): Promise<void> {
  const wizard = ctx.session.contact_wizard
  if (!wizard) return

  const text = ctx.message?.text?.trim()
  if (!text) return

  if (wizard.step === 'awaiting_name') {
    wizard.display_name = text
    wizard.step = 'awaiting_phone'
    await editContactWizardMessage(ctx, t(ctx, 'contacts.add_phone_prompt'), contactSkipPhoneKeyboard(ctx))
    return
  }

  if (wizard.step === 'awaiting_phone') {
    const displayName = wizard.display_name!
    const msgId = wizard.wizardMessageId
    ctx.session.contact_wizard = undefined
    try {
      const contact = await addContact(ctx.user.id, displayName, text)
      await editContactWizardMessageById(ctx, msgId, t(ctx, 'contacts.added', { name: contact.display_name }))
    } catch (err: unknown) {
      if (isUniqueViolation(err)) {
        await editContactWizardMessageById(ctx, msgId, t(ctx, 'contacts.name_taken'))
        ctx.session.contact_wizard = { step: 'awaiting_name', wizardMessageId: msgId }
        return
      }
      ctx.logger.error({ err }, 'addContact failed')
      await editContactWizardMessageById(ctx, msgId, t(ctx, 'errors.generic'))
    }
    await showContactListById(ctx, msgId)
    return
  }

  if (wizard.step === 'awaiting_username') {
    const msgId = wizard.wizardMessageId
    const handles = parseUsernameList(text)

    // Nothing parseable — keep the wizard open so the user can retry
    if (handles.length === 0) {
      const cancelKeyboard = new InlineKeyboard()
        .text(t(ctx, 'contacts.cancel_share'), encode('contact', 'cancel', 'now'))
      await editContactWizardMessageById(ctx, msgId, t(ctx, 'contacts.username_prompt'), cancelKeyboard)
      return
    }

    ctx.session.contact_wizard = undefined

    let result: UsernameAddResult
    try {
      result = await addContactsByUsernames(ctx.user.id, handles)
    } catch (err) {
      ctx.logger.error({ err }, 'addContactsByUsernames failed')
      await editContactWizardMessageById(ctx, msgId, t(ctx, 'errors.generic'))
      return
    }

    const lines: string[] = []
    const added = [...result.linked, ...result.added]
    if (added.length) lines.push(t(ctx, 'contacts.batch_added', { names: added.join(', ') }))
    if (result.skipped.length) lines.push(t(ctx, 'contacts.batch_skipped', { names: result.skipped.join(', ') }))
    if (result.notFound.length) {
      lines.push(t(ctx, 'contacts.batch_not_found', { names: result.notFound.map((h) => `@${h}`).join(', ') }))
    }
    if (lines.length === 0) {
      lines.push(result.selfSkipped ? t(ctx, 'contacts.share_yourself') : t(ctx, 'contacts.pick_none'))
    }

    await editContactWizardMessageById(ctx, msgId, lines.join('\n'))
    await showContactListById(ctx, msgId)
  }
}

export async function contactSkipPhoneHandler(ctx: MyContext): Promise<void> {
  const wizard = ctx.session.contact_wizard
  const displayName = wizard?.display_name
  const msgId = wizard?.wizardMessageId
  ctx.session.contact_wizard = undefined

  await ctx.answerCallbackQuery()

  if (!displayName) return

  try {
    const contact = await addContact(ctx.user.id, displayName)
    await editContactWizardMessageById(ctx, msgId, t(ctx, 'contacts.added', { name: contact.display_name }))
  } catch (err: unknown) {
    if (isUniqueViolation(err)) {
      await editContactWizardMessageById(ctx, msgId, t(ctx, 'contacts.name_taken'))
      ctx.session.contact_wizard = { step: 'awaiting_name', wizardMessageId: msgId }
      return
    }
    ctx.logger.error({ err }, 'addContact (no phone) failed')
    await editContactWizardMessageById(ctx, msgId, t(ctx, 'errors.generic'))
  }
  await showContactListById(ctx, msgId)
}

export async function contactCancelHandler(ctx: MyContext): Promise<void> {
  const pickerMsgId = ctx.session.contact_wizard?.pickerMessageId
  ctx.session.contact_wizard = undefined
  await ctx.answerCallbackQuery()
  // Clean up the multi-select picker's reply-keyboard carrier message, if any
  if (pickerMsgId && ctx.chat) {
    await ctx.api.deleteMessage(ctx.chat.id, pickerMsgId).catch(() => undefined)
  }
  await showContactList(ctx)
}

export async function contactViewHandler(ctx: MyContext, contactId: string): Promise<void> {
  const contact = await findContactById(contactId)
  if (!contact || contact.owner_id !== ctx.user.id) {
    await editContactMessage(ctx, t(ctx, 'errors.not_found'))
    return
  }

  const lines = [`<b>${contact.display_name}</b>`]
  if (contact.phone) {
    lines.push(t(ctx, 'contacts.detail_phone', { phone: contact.phone }))
  } else {
    lines.push(t(ctx, 'contacts.detail_no_phone'))
  }
  lines.push(contact.linked_user_id
    ? t(ctx, 'contacts.detail_linked')
    : t(ctx, 'contacts.detail_not_linked'))

  await editContactMessage(ctx, lines.join('\n'), contactDetailKeyboard(contact.id, ctx), 'HTML')
}

export async function contactDeleteHandler(ctx: MyContext, contactId: string): Promise<void> {
  const contact = await findContactById(contactId)
  if (!contact || contact.owner_id !== ctx.user.id) {
    await editContactMessage(ctx, t(ctx, 'errors.not_found'))
    return
  }

  const referenced = await isContactReferencedInBills(contactId)
  if (referenced) {
    await editContactMessage(ctx, t(ctx, 'contacts.cannot_delete'))
    return
  }

  await deleteContact(contactId)
  await showContactList(ctx)
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function showContactList(ctx: MyContext): Promise<void> {
  const contacts = await listContacts(ctx.user.id)
  const text = contacts.length === 0
    ? t(ctx, 'contacts.empty')
    : t(ctx, 'contacts.list_title', { count: String(contacts.length) })
  await editContactMessage(ctx, text, contactListKeyboard(contacts, ctx))
}

async function showContactListById(ctx: MyContext, msgId?: number): Promise<void> {
  const contacts = await listContacts(ctx.user.id)
  const text = contacts.length === 0
    ? t(ctx, 'contacts.empty')
    : t(ctx, 'contacts.list_title', { count: String(contacts.length) })
  await editContactWizardMessageById(ctx, msgId, text, contactListKeyboard(contacts, ctx))
}

/** Edit the message that triggered the current callback (or the main message) */
async function editContactMessage(
  ctx: MyContext,
  text: string,
  keyboard?: InlineKeyboard,
  parseMode?: 'HTML'
): Promise<void> {
  const msgId = ctx.callbackQuery?.message?.message_id ?? ctx.session.mainMessageId
  const chatId = ctx.chat?.id
  if (msgId && chatId) {
    await ctx.api.editMessageText(chatId, msgId, text, {
      reply_markup: keyboard ?? new InlineKeyboard(),
      parse_mode: parseMode,
    }).catch(() => undefined)
  }
}

/** Edit using the wizardMessageId stored in contact_wizard */
async function editContactWizardMessage(
  ctx: MyContext,
  text: string,
  keyboard?: InlineKeyboard,
  parseMode?: 'HTML'
): Promise<void> {
  const msgId = ctx.session.contact_wizard?.wizardMessageId ?? ctx.session.mainMessageId
  await editContactWizardMessageById(ctx, msgId, text, keyboard, parseMode)
}

async function editContactWizardMessageById(
  ctx: MyContext,
  msgId: number | undefined,
  text: string,
  keyboard?: InlineKeyboard,
  parseMode?: 'HTML'
): Promise<void> {
  const chatId = ctx.chat?.id
  if (msgId && chatId) {
    await ctx.api.editMessageText(chatId, msgId, text, {
      reply_markup: keyboard ?? new InlineKeyboard(),
      parse_mode: parseMode,
    }).catch(() => undefined)
  }
}

/** Build a localized summary of a batch add (added / pending-link / skipped). */
function formatBatchResult(ctx: MyContext, r: BatchResult): string {
  const lines: string[] = []
  const added = [...r.linked, ...r.added]
  if (added.length) lines.push(t(ctx, 'contacts.batch_added', { names: added.join(', ') }))
  if (r.added.length) lines.push(t(ctx, 'contacts.batch_pending', { names: r.added.join(', ') }))
  if (r.skipped.length) lines.push(t(ctx, 'contacts.batch_skipped', { names: r.skipped.join(', ') }))
  if (lines.length === 0) lines.push(t(ctx, 'contacts.pick_none'))
  return lines.join('\n')
}

function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.message.includes('unique') || err.message.includes('duplicate'))
  )
}

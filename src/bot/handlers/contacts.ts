import { InlineKeyboard } from 'grammy'
import type { MyContext } from '../index'
import { t } from '../../i18n'
import {
  listContacts,
  findContactById,
  addContact,
  isContactReferencedInBills,
  deleteContact,
} from '../../services/contact.service'
import { findUserByUsername } from '../../services/user.service'
import { normalizeUsername } from '../../utils/username'
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
  ctx.session.contact_wizard = { step: 'awaiting_contact_share', wizardMessageId: msgId }

  const cancelKeyboard = new InlineKeyboard()
    .text(t(ctx, 'contacts.cancel_share'), encode('contact', 'cancel', 'now'))

  await editContactWizardMessage(ctx, t(ctx, 'contacts.share_prompt'), cancelKeyboard)
}

export async function contactStartUsernameHandler(ctx: MyContext): Promise<void> {
  const msgId = ctx.callbackQuery?.message?.message_id ?? ctx.session.mainMessageId
  ctx.session.contact_wizard = { step: 'awaiting_username', wizardMessageId: msgId }

  const cancelKeyboard = new InlineKeyboard()
    .text(t(ctx, 'contacts.cancel_share'), encode('contact', 'cancel', 'now'))

  await editContactWizardMessage(ctx, t(ctx, 'contacts.username_prompt'), cancelKeyboard)
}

/** Called when the user forwards a Telegram contact during the contacts import flow */
export async function contactShareHandler(ctx: MyContext): Promise<void> {
  const contact = ctx.message?.contact
  const wizard = ctx.session.contact_wizard

  if (!contact || !wizard) return

  // Delete the forwarded contact message to keep the chat clean
  await ctx.deleteMessage().catch(() => undefined)

  if (contact.user_id === ctx.from?.id) {
    ctx.session.contact_wizard = undefined
    await editContactWizardMessage(ctx, t(ctx, 'contacts.share_yourself'))
    await showContactList(ctx)
    return
  }

  const firstName = contact.first_name ?? ''
  const lastName = contact.last_name ? ` ${contact.last_name}` : ''
  const displayName = `${firstName}${lastName}`.trim() || contact.phone_number

  ctx.session.contact_wizard = undefined
  try {
    const added = await addContact(ctx.user.id, displayName, contact.phone_number)
    await editContactWizardMessage(ctx, t(ctx, 'contacts.added', { name: added.display_name }))
  } catch (err: unknown) {
    if (isUniqueViolation(err)) {
      await editContactWizardMessage(ctx, t(ctx, 'contacts.name_taken'))
      ctx.session.contact_wizard = { step: 'awaiting_name', wizardMessageId: wizard.wizardMessageId }
      return
    }
    ctx.logger.error({ err }, 'addContact (telegram share) failed')
    await editContactWizardMessage(ctx, t(ctx, 'contacts.share_error'))
  }
  await showContactList(ctx)
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
    const handle = normalizeUsername(text)
    const msgId = wizard.wizardMessageId

    const found = await findUserByUsername(handle)
    if (!found) {
      const cancelKeyboard = new InlineKeyboard()
        .text(t(ctx, 'contacts.cancel_share'), encode('contact', 'cancel', 'now'))
      await editContactWizardMessageById(
        ctx, msgId,
        t(ctx, 'contacts.username_not_found', { username: handle }),
        cancelKeyboard,
      )
      return
    }

    if (found.id === ctx.user.id) {
      const cancelKeyboard = new InlineKeyboard()
        .text(t(ctx, 'contacts.cancel_share'), encode('contact', 'cancel', 'now'))
      await editContactWizardMessageById(ctx, msgId, t(ctx, 'contacts.share_yourself'), cancelKeyboard)
      return
    }

    ctx.session.contact_wizard = undefined
    const displayName = [found.first_name, found.last_name].filter(Boolean).join(' ')
    try {
      const contact = await addContact(ctx.user.id, displayName, found.phone, found.id)
      await editContactWizardMessageById(
        ctx, msgId,
        t(ctx, 'contacts.username_found', { name: contact.display_name }),
      )
    } catch (err: unknown) {
      if (isUniqueViolation(err)) {
        await editContactWizardMessageById(ctx, msgId, t(ctx, 'contacts.name_taken'))
        ctx.session.contact_wizard = { step: 'awaiting_name', wizardMessageId: msgId }
        return
      }
      ctx.logger.error({ err }, 'addContact (username) failed')
      await editContactWizardMessageById(ctx, msgId, t(ctx, 'errors.generic'))
    }
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
  ctx.session.contact_wizard = undefined
  await ctx.answerCallbackQuery()
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

function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.message.includes('unique') || err.message.includes('duplicate'))
  )
}

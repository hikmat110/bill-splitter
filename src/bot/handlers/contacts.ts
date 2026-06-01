import type { MyContext } from '../index'
import { t } from '../../i18n'
import {
  listContacts,
  findContactById,
  addContact,
  isContactReferencedInBills,
  deleteContact,
} from '../../services/contact.service'
import {
  contactListKeyboard,
  contactDetailKeyboard,
  contactSkipPhoneKeyboard,
} from '../keyboards'
import { decode } from '../../utils/callback'
import { showMainMenu } from './menu'

export async function contactsMenuHandler(ctx: MyContext): Promise<void> {
  const contacts = await listContacts(ctx.user.id)
  const text = contacts.length === 0
    ? t(ctx, 'contacts.empty')
    : t(ctx, 'contacts.list_title', { count: String(contacts.length) })

  await ctx.editMessageText(text, {
    reply_markup: contactListKeyboard(contacts, ctx),
  }).catch(() => ctx.reply(text, { reply_markup: contactListKeyboard(contacts, ctx) }))
}

export async function contactAddStartHandler(ctx: MyContext): Promise<void> {
  ctx.session.contact_wizard = { step: 'awaiting_name' }
  await ctx.reply(t(ctx, 'contacts.add_name_prompt'))
}

export async function contactTextHandler(ctx: MyContext): Promise<void> {
  const wizard = ctx.session.contact_wizard
  if (!wizard) return

  const text = ctx.message?.text?.trim()
  if (!text) return

  if (wizard.step === 'awaiting_name') {
    wizard.display_name = text
    wizard.step = 'awaiting_phone'
    await ctx.reply(t(ctx, 'contacts.add_phone_prompt'), {
      reply_markup: contactSkipPhoneKeyboard(ctx),
    })
    return
  }

  if (wizard.step === 'awaiting_phone') {
    const displayName = wizard.display_name!
    ctx.session.contact_wizard = undefined
    try {
      const contact = await addContact(ctx.user.id, displayName, text)
      await ctx.reply(t(ctx, 'contacts.added', { name: contact.display_name }))
    } catch (err: unknown) {
      if (isUniqueViolation(err)) {
        await ctx.reply(t(ctx, 'contacts.name_taken'))
        ctx.session.contact_wizard = { step: 'awaiting_name' }
        return
      }
      ctx.logger.error({ err }, 'addContact failed')
      await ctx.reply(t(ctx, 'errors.generic'))
    }
    await showContactList(ctx)
  }
}

export async function contactSkipPhoneHandler(ctx: MyContext): Promise<void> {
  const displayName = ctx.session.contact_wizard?.display_name
  ctx.session.contact_wizard = undefined

  if (!displayName) {
    await ctx.answerCallbackQuery()
    return
  }

  try {
    const contact = await addContact(ctx.user.id, displayName)
    await ctx.answerCallbackQuery()
    await ctx.reply(t(ctx, 'contacts.added', { name: contact.display_name }))
  } catch (err: unknown) {
    await ctx.answerCallbackQuery()
    if (isUniqueViolation(err)) {
      await ctx.reply(t(ctx, 'contacts.name_taken'))
      ctx.session.contact_wizard = { step: 'awaiting_name' }
      return
    }
    ctx.logger.error({ err }, 'addContact (no phone) failed')
    await ctx.reply(t(ctx, 'errors.generic'))
  }
  await showContactList(ctx)
}

export async function contactCancelHandler(ctx: MyContext): Promise<void> {
  ctx.session.contact_wizard = undefined
  await ctx.answerCallbackQuery()
  await showContactList(ctx)
}

export async function contactViewHandler(ctx: MyContext, contactId: string): Promise<void> {
  const contact = await findContactById(contactId)
  if (!contact || contact.owner_id !== ctx.user.id) {
    await ctx.reply(t(ctx, 'errors.not_found'))
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

  await ctx.editMessageText(lines.join('\n'), {
    parse_mode: 'HTML',
    reply_markup: contactDetailKeyboard(contact.id, ctx),
  }).catch(() =>
    ctx.reply(lines.join('\n'), {
      parse_mode: 'HTML',
      reply_markup: contactDetailKeyboard(contact.id, ctx),
    })
  )
}

export async function contactDeleteHandler(ctx: MyContext, contactId: string): Promise<void> {
  const contact = await findContactById(contactId)
  if (!contact || contact.owner_id !== ctx.user.id) {
    await ctx.reply(t(ctx, 'errors.not_found'))
    return
  }

  const referenced = await isContactReferencedInBills(contactId)
  if (referenced) {
    await ctx.reply(t(ctx, 'contacts.cannot_delete'))
    return
  }

  await deleteContact(contactId)
  await ctx.reply(t(ctx, 'contacts.deleted'))
  await showContactList(ctx)
}

async function showContactList(ctx: MyContext): Promise<void> {
  const contacts = await listContacts(ctx.user.id)
  const text = contacts.length === 0
    ? t(ctx, 'contacts.empty')
    : t(ctx, 'contacts.list_title', { count: String(contacts.length) })
  await ctx.reply(text, { reply_markup: contactListKeyboard(contacts, ctx) })
}

function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.message.includes('unique') || err.message.includes('duplicate'))
  )
}

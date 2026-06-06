import type { Bot } from 'grammy'
import { InlineKeyboard } from 'grammy'
import type { MyContext } from '../index'
import { t } from '../../i18n'
import { listContacts, findContactById, findOrCreateSelfContact } from '../../services/contact.service'
import { createBill } from '../../services/bill.service'
import { sendBillNotifications } from '../../services/notification.service'
import {
  participantSelectKeyboard,
  itemShareKeyboard,
  itemNextKeyboard,
  serviceChargeKeyboard,
  tipKeyboard,
  billReviewKeyboard,
} from '../keyboards'
import { formatMoney } from '../../utils/format'
import { computeSettlement } from '../../utils/settlement'
import { showMainMenu } from './menu'
import type { WizardItem } from '../middleware/session'
import type { Contact } from '../../db/schema'

// ─── Entry point ─────────────────────────────────────────────────────────────

export async function newBillStartHandler(ctx: MyContext): Promise<void> {
  // Reuse the message that triggered this (main menu message)
  const msgId = ctx.callbackQuery?.message?.message_id ?? ctx.session.mainMessageId

  ctx.session.bill_wizard = {
    step: 'awaiting_title',
    wizardMessageId: msgId,
    participantContactIds: [],
    items: [],
    servicePct: 0,
    serviceFixed: 0n,
    tip: 0n,
  }

  await editWizardMessage(ctx, t(ctx, 'bill.ask_title'))
}

// ─── Text dispatcher ──────────────────────────────────────────────────────────

export async function billTextHandler(ctx: MyContext): Promise<void> {
  const wizard = ctx.session.bill_wizard
  if (!wizard) return

  const text = ctx.message?.text?.trim()
  if (!text) return

  switch (wizard.step) {
    case 'awaiting_title':
      return saveTitleStep(ctx, text)
    case 'awaiting_item_name':
      return saveItemNameStep(ctx, text)
    case 'awaiting_item_price':
      return saveItemPriceStep(ctx, text)
    case 'awaiting_service_custom':
      return saveServiceCustomStep(ctx, text)
    case 'awaiting_tip_custom':
      return saveTipCustomStep(ctx, text)
  }
}

// ─── Callback dispatcher ──────────────────────────────────────────────────────

export async function billCallbackHandler(
  ctx: MyContext,
  action: string,
  id: string,
  bot: Bot<MyContext>
): Promise<void> {
  const wizard = ctx.session.bill_wizard
  if (!wizard) return

  switch (action) {
    case 'toggle_participant':
      return toggleParticipant(ctx, id)
    case 'participants_done':
      return participantsDoneStep(ctx)
    case 'toggle_share':
      return toggleShare(ctx, id)
    case 'shares_all':
      return selectAllShares(ctx)
    case 'shares_done':
      return sharesDoneStep(ctx)
    case 'add_item':
      return addAnotherItemStep(ctx)
    case 'items_done':
      return itemsDoneStep(ctx)
    case 'service':
      return serviceChargeStep(ctx, id)
    case 'tip':
      return tipStep(ctx, id)
    case 'send':
      return sendBillStep(ctx, bot)
    case 'edit':
      return editBillStep(ctx)
    case 'cancel':
      return cancelBillStep(ctx)
  }
}

// ─── Steps ────────────────────────────────────────────────────────────────────

async function saveTitleStep(ctx: MyContext, title: string): Promise<void> {
  const wizard = ctx.session.bill_wizard!
  const [allContacts, selfContact] = await Promise.all([
    listContacts(ctx.user.id),
    findOrCreateSelfContact(ctx.user.id, ctx.user.first_name),
  ])

  if (allContacts.length === 0) {
    await editWizardMessage(ctx, t(ctx, 'bill.no_contacts'))
    ctx.session.bill_wizard = undefined
    return
  }

  wizard.title = title
  wizard.step = 'awaiting_participants'
  wizard.participantContactIds = []

  await editWizardMessage(
    ctx,
    t(ctx, 'bill.ask_participants'),
    participantSelectKeyboard(selfContact, allContacts, [], ctx)
  )
}

async function toggleParticipant(ctx: MyContext, contactId: string): Promise<void> {
  const wizard = ctx.session.bill_wizard!
  const idx = wizard.participantContactIds.indexOf(contactId)
  if (idx === -1) {
    wizard.participantContactIds.push(contactId)
  } else {
    wizard.participantContactIds.splice(idx, 1)
  }

  const [allContacts, selfContact] = await Promise.all([
    listContacts(ctx.user.id),
    findOrCreateSelfContact(ctx.user.id, ctx.user.first_name),
  ])
  await editWizardMessage(
    ctx,
    t(ctx, 'bill.ask_participants'),
    participantSelectKeyboard(selfContact, allContacts, wizard.participantContactIds, ctx)
  )
}

async function participantsDoneStep(ctx: MyContext): Promise<void> {
  const wizard = ctx.session.bill_wizard!
  if (wizard.participantContactIds.length === 0) {
    await ctx.answerCallbackQuery(t(ctx, 'bill.no_participants'))
    return
  }
  wizard.step = 'awaiting_item_name'
  wizard.items = []
  await editWizardMessage(ctx, t(ctx, 'bill.ask_item_name', { n: '1' }))
}

async function saveItemNameStep(ctx: MyContext, name: string): Promise<void> {
  const wizard = ctx.session.bill_wizard!
  wizard.currentItem = { name, shareContactIds: [...wizard.participantContactIds] }
  wizard.step = 'awaiting_item_price'
  await editWizardMessage(ctx, t(ctx, 'bill.ask_item_price', { name }))
}

async function saveItemPriceStep(ctx: MyContext, text: string): Promise<void> {
  const wizard = ctx.session.bill_wizard!
  const parsed = parseInt(text.replace(/[\s,._]/g, ''), 10)
  if (isNaN(parsed) || parsed <= 0 || parsed > 10_000_000_000) {
    await editWizardMessage(ctx, t(ctx, 'bill.price_invalid'))
    return
  }

  wizard.currentItem!.price = BigInt(parsed)
  wizard.step = 'awaiting_item_shares'

  const participantContacts = await getParticipantContacts(wizard.participantContactIds)
  const selected = wizard.currentItem!.shareContactIds ?? wizard.participantContactIds

  await editWizardMessage(
    ctx,
    t(ctx, 'bill.ask_item_shares', { name: wizard.currentItem!.name! }),
    itemShareKeyboard(participantContacts, selected, ctx)
  )
}

async function toggleShare(ctx: MyContext, contactId: string): Promise<void> {
  const wizard = ctx.session.bill_wizard!
  const current = wizard.currentItem!
  current.shareContactIds = current.shareContactIds ?? [...wizard.participantContactIds]

  const idx = current.shareContactIds.indexOf(contactId)
  if (idx === -1) {
    current.shareContactIds.push(contactId)
  } else {
    current.shareContactIds.splice(idx, 1)
  }

  const participantContacts = await getParticipantContacts(wizard.participantContactIds)
  await editWizardMessage(
    ctx,
    t(ctx, 'bill.ask_item_shares', { name: current.name! }),
    itemShareKeyboard(participantContacts, current.shareContactIds, ctx)
  )
}

async function selectAllShares(ctx: MyContext): Promise<void> {
  const wizard = ctx.session.bill_wizard!
  wizard.currentItem!.shareContactIds = [...wizard.participantContactIds]
  const participantContacts = await getParticipantContacts(wizard.participantContactIds)
  await editWizardMessage(
    ctx,
    t(ctx, 'bill.ask_item_shares', { name: wizard.currentItem!.name! }),
    itemShareKeyboard(participantContacts, wizard.currentItem!.shareContactIds!, ctx)
  )
}

async function sharesDoneStep(ctx: MyContext): Promise<void> {
  const wizard = ctx.session.bill_wizard!
  const current = wizard.currentItem!

  if (!current.shareContactIds || current.shareContactIds.length === 0) {
    await ctx.answerCallbackQuery(t(ctx, 'bill.no_shares'))
    return
  }

  wizard.items.push(current as WizardItem)
  wizard.currentItem = undefined

  await editWizardMessage(ctx, t(ctx, 'bill.item_added'), itemNextKeyboard(ctx))
}

async function addAnotherItemStep(ctx: MyContext): Promise<void> {
  const wizard = ctx.session.bill_wizard!
  wizard.step = 'awaiting_item_name'
  await editWizardMessage(
    ctx,
    t(ctx, 'bill.ask_item_name', { n: String(wizard.items.length + 1) })
  )
}

async function itemsDoneStep(ctx: MyContext): Promise<void> {
  const wizard = ctx.session.bill_wizard!
  wizard.step = 'awaiting_service'
  await editWizardMessage(ctx, t(ctx, 'bill.ask_service'), serviceChargeKeyboard(ctx))
}

async function serviceChargeStep(ctx: MyContext, choice: string): Promise<void> {
  const wizard = ctx.session.bill_wizard!

  if (choice === 'custom') {
    wizard.step = 'awaiting_service_custom'
    await editWizardMessage(ctx, t(ctx, 'bill.service_custom_prompt'))
    return
  }

  const pct = parseFloat(choice)
  if (isNaN(pct)) return
  wizard.servicePct = pct
  wizard.serviceFixed = 0n
  wizard.step = 'awaiting_tip'
  await editWizardMessage(ctx, t(ctx, 'bill.ask_tip'), tipKeyboard(ctx))
}

async function saveServiceCustomStep(ctx: MyContext, text: string): Promise<void> {
  const wizard = ctx.session.bill_wizard!
  const pct = parseFloat(text.replace(',', '.'))
  if (isNaN(pct) || pct < 0 || pct > 100) {
    await editWizardMessage(ctx, t(ctx, 'bill.service_pct_invalid'))
    return
  }
  wizard.servicePct = pct
  wizard.serviceFixed = 0n
  wizard.step = 'awaiting_tip'
  await editWizardMessage(ctx, t(ctx, 'bill.ask_tip'), tipKeyboard(ctx))
}

async function tipStep(ctx: MyContext, choice: string): Promise<void> {
  const wizard = ctx.session.bill_wizard!

  if (choice === 'custom') {
    wizard.step = 'awaiting_tip_custom'
    await editWizardMessage(ctx, t(ctx, 'bill.tip_custom_prompt'))
    return
  }

  const amount = parseInt(choice, 10)
  if (isNaN(amount)) return
  wizard.tip = BigInt(amount)
  wizard.step = 'review'
  await showReview(ctx)
}

async function saveTipCustomStep(ctx: MyContext, text: string): Promise<void> {
  const wizard = ctx.session.bill_wizard!
  const amount = parseInt(text.replace(/[\s,._]/g, ''), 10)
  if (isNaN(amount) || amount < 0) {
    await editWizardMessage(ctx, t(ctx, 'bill.tip_invalid'))
    return
  }
  wizard.tip = BigInt(amount)
  wizard.step = 'review'
  await showReview(ctx)
}

async function showReview(ctx: MyContext): Promise<void> {
  const wizard = ctx.session.bill_wizard!
  const participantContacts = await getParticipantContacts(wizard.participantContactIds)
  const contactMap = new Map(participantContacts.map((c) => [c.id, c]))

  const itemSpecs = wizard.items.map((it) => ({
    price: it.price,
    shareContactIds: it.shareContactIds,
  }))

  const settlement = computeSettlement({
    items: itemSpecs,
    servicePct: wizard.servicePct,
    serviceFixed: wizard.serviceFixed,
    tip: wizard.tip,
  })

  const lines: string[] = [
    t(ctx, 'bill.review_title', { title: wizard.title ?? '' }),
    '',
  ]

  for (const item of wizard.items) {
    lines.push(`  ${item.name}: ${formatMoney(item.price)}`)
  }
  lines.push(`${t(ctx, 'bill.review_subtotal', { amount: formatMoney(settlement.subtotal) })}`)
  if (wizard.servicePct > 0) {
    const svcAmount = settlement.total - settlement.subtotal - wizard.tip
    lines.push(t(ctx, 'bill.review_service', { amount: formatMoney(svcAmount > 0n ? svcAmount : 0n) }))
  }
  if (wizard.tip > 0n) {
    lines.push(t(ctx, 'bill.review_tip', { amount: formatMoney(wizard.tip) }))
  }
  lines.push(t(ctx, 'bill.review_total', { amount: formatMoney(settlement.total) }))
  lines.push('')
  lines.push(t(ctx, 'bill.review_participants'))
  for (const [contactId, amount] of settlement.shares) {
    const name = contactMap.get(contactId)?.display_name ?? contactId
    lines.push(t(ctx, 'bill.review_line', { name, amount: formatMoney(amount) }))
  }

  await editWizardMessage(ctx, lines.join('\n'), billReviewKeyboard(ctx), 'HTML')
}

async function sendBillStep(ctx: MyContext, bot: Bot<MyContext>): Promise<void> {
  const wizard = ctx.session.bill_wizard!

  let bill
  try {
    bill = await createBill({
      creatorId: ctx.user.id,
      title: wizard.title!,
      items: wizard.items.map((it, i) => ({
        name: it.name,
        price: it.price,
        quantity: 1,
        position: i,
        shareContactIds: it.shareContactIds,
      })),
      servicePct: wizard.servicePct,
      serviceFixed: wizard.serviceFixed,
      tip: wizard.tip,
      participantContactIds: wizard.participantContactIds,
    })
  } catch (err) {
    ctx.logger.error({ err }, 'createBill failed')
    await ctx.reply(t(ctx, 'errors.generic'))
    return
  }

  ctx.session.bill_wizard = undefined
  await showMainMenu(ctx)

  // Send notifications non-blocking; pass creator's card number so recipients can copy it
  await sendBillNotifications(bot, bill.id, ctx.user.card_number).catch((err) =>
    ctx.logger.error({ err, billId: bill.id }, 'sendBillNotifications failed')
  )
}

async function editBillStep(ctx: MyContext): Promise<void> {
  const wizard = ctx.session.bill_wizard!
  wizard.step = 'awaiting_title'
  wizard.participantContactIds = []
  wizard.items = []
  wizard.currentItem = undefined
  wizard.servicePct = 0
  wizard.serviceFixed = 0n
  wizard.tip = 0n
  await editWizardMessage(ctx, t(ctx, 'bill.ask_title'))
}

async function cancelBillStep(ctx: MyContext): Promise<void> {
  ctx.session.bill_wizard = undefined
  await showMainMenu(ctx)
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getParticipantContacts(ids: string[]): Promise<Contact[]> {
  if (ids.length === 0) return []
  const results: Contact[] = []
  for (const id of ids) {
    const c = await findContactById(id)
    if (c) results.push(c)
  }
  return results
}

async function editWizardMessage(
  ctx: MyContext,
  text: string,
  keyboard?: InlineKeyboard,
  parseMode?: 'HTML'
): Promise<void> {
  const msgId = ctx.session.bill_wizard?.wizardMessageId
  const chatId = ctx.chat?.id
  if (msgId && chatId) {
    await ctx.api
      .editMessageText(chatId, msgId, text, {
        reply_markup: keyboard ?? new InlineKeyboard(),
        parse_mode: parseMode,
      })
      .catch(() => undefined)
  }
}

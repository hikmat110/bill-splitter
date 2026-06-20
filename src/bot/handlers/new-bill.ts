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
  tipPayerKeyboard,
  billReviewKeyboard,
  receiptSkipKeyboard,
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
    serviceFixed: 0,
    tip: 0,
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
    case 'tip_payer':
      return tipPayerStep(ctx, id)
    case 'receipt_skip':
      return receiptSkipStep(ctx)
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
  const parsed = parseMoneyInput(text)
  if (parsed === null || parsed <= 0 || parsed > 10_000_000_000) {
    await editWizardMessage(ctx, t(ctx, 'bill.price_invalid'))
    return
  }

  wizard.currentItem!.price = parsed
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
  wizard.serviceFixed = 0
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
  wizard.serviceFixed = 0
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

  const amount = parseFloat(choice)
  if (isNaN(amount)) return
  wizard.tip = amount
  await proceedAfterTip(ctx)
}

async function saveTipCustomStep(ctx: MyContext, text: string): Promise<void> {
  const wizard = ctx.session.bill_wizard!
  const amount = parseMoneyInput(text)
  if (amount === null || amount < 0) {
    await editWizardMessage(ctx, t(ctx, 'bill.tip_invalid'))
    return
  }
  wizard.tip = amount
  await proceedAfterTip(ctx)
}

/**
 * After the tip is set: if there's a tip and at least one non-creator
 * participant, ask who paid it (default = creator). Otherwise offer the
 * optional receipt photo step.
 */
async function proceedAfterTip(ctx: MyContext): Promise<void> {
  const wizard = ctx.session.bill_wizard!
  if (wizard.tip > 0) {
    const participantContacts = await getParticipantContacts(wizard.participantContactIds)
    const others = participantContacts.filter((c) => c.linked_user_id !== ctx.user.id)
    if (others.length > 0) {
      wizard.step = 'awaiting_tip_payer'
      await editWizardMessage(
        ctx,
        t(ctx, 'bill.ask_tip_payer'),
        tipPayerKeyboard(others, wizard.tipPaidByContactId, ctx)
      )
      return
    }
  }
  wizard.tipPaidByContactId = undefined
  await askReceiptPhoto(ctx)
}

async function tipPayerStep(ctx: MyContext, choice: string): Promise<void> {
  const wizard = ctx.session.bill_wizard!
  // "creator" is the default payer and is never credited.
  wizard.tipPaidByContactId = choice === 'creator' ? undefined : choice
  await askReceiptPhoto(ctx)
}

/**
 * Optional main-cheque photo step, shown right before review. The user can send
 * a photo (handled by photoHandler, which advances to review) or tap Skip
 * (receipt_skip callback → goes straight to review).
 */
async function askReceiptPhoto(ctx: MyContext): Promise<void> {
  const wizard = ctx.session.bill_wizard!
  wizard.step = 'awaiting_receipt_photo'
  await editWizardMessage(ctx, t(ctx, 'split.receipt_prompt'), receiptSkipKeyboard(ctx))
}

async function receiptSkipStep(ctx: MyContext): Promise<void> {
  const wizard = ctx.session.bill_wizard!
  wizard.step = 'review'
  await showReview(ctx)
}

export async function showReview(ctx: MyContext): Promise<void> {
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
    tipPaidByContactId: wizard.tipPaidByContactId ?? null,
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
    lines.push(t(ctx, 'bill.review_service', { amount: formatMoney(svcAmount > 0 ? svcAmount : 0) }))
  }
  if (wizard.tip > 0) {
    lines.push(t(ctx, 'bill.review_tip', { amount: formatMoney(wizard.tip) }))
    if (wizard.tipPaidByContactId) {
      const payer = contactMap.get(wizard.tipPaidByContactId)
      if (payer) {
        lines.push(t(ctx, 'bill.review_tip_payer', { name: payer.display_name }))
      }
    }
  }
  lines.push(t(ctx, 'bill.review_total', { amount: formatMoney(settlement.total) }))
  lines.push('')
  lines.push(t(ctx, 'bill.review_participants'))
  for (const [contactId, amount] of settlement.shares) {
    const c = contactMap.get(contactId)
    const name =
      c?.linked_user_id === ctx.user.id
        ? t(ctx, 'bill.me_label', { name: c?.display_name ?? '' })
        : c?.display_name ?? contactId
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
      tipPaidByContactId: wizard.tipPaidByContactId ?? null,
      participantContactIds: wizard.participantContactIds,
      receiptAttachmentId: wizard.receiptAttachmentId ?? null,
      receiptMime: wizard.receiptMime ?? null,
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
  wizard.serviceFixed = 0
  wizard.tip = 0
  wizard.tipPaidByContactId = undefined
  wizard.receiptAttachmentId = undefined
  wizard.receiptMime = undefined
  await editWizardMessage(ctx, t(ctx, 'bill.ask_title'))
}

async function cancelBillStep(ctx: MyContext): Promise<void> {
  ctx.session.bill_wizard = undefined
  await showMainMenu(ctx)
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Parse a money amount typed by the user into a 2-decimal som number, or null if
 * invalid. ru/uz locale: space/underscore group thousands, comma or dot is the
 * decimal separator (so "10 000" → 10000, "10,33" → 10.33).
 */
function parseMoneyInput(text: string): number | null {
  const normalized = text.replace(/[\s_]/g, '').replace(',', '.')
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null
  const n = parseFloat(normalized)
  if (!isFinite(n)) return null
  return Math.round(n * 100) / 100
}

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

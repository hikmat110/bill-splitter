import { InlineKeyboard } from 'grammy'
import type { MyContext } from '../index'
import { t } from '../../i18n'
import { encode } from '../../utils/callback'
import { config } from '../../config'
import { cardDisplayLabel } from '../../utils/format'
import { buildSplitPayload, miniAppLink, startLink } from '../../utils/deep-link'
import type { Card, Contact } from '../../db/schema'

/** Inline `web_app` buttons are accepted by Telegram only in private chats —
 *  anywhere else the send fails with BUTTON_TYPE_INVALID. These keyboards are
 *  built for the private bot, but guard here too so a group code path can never
 *  turn a missing check into a failed send. */
function canOpenApp(ctx: MyContext): boolean {
  return !!config.WEBAPP_URL && ctx.chat?.type === 'private'
}

/** Prepend the Mini App launcher row (only when a public HTTPS URL is configured). */
function withOpenApp(kb: InlineKeyboard, ctx: MyContext): InlineKeyboard {
  if (canOpenApp(ctx)) {
    kb.webApp(t(ctx, 'menu.open_app'), config.WEBAPP_URL!).row()
  }
  return kb
}

/** Just the Mini App launcher, or undefined when no URL is configured. */
export function openAppKeyboard(ctx: MyContext): InlineKeyboard | undefined {
  if (!canOpenApp(ctx)) return undefined
  return new InlineKeyboard().webApp(t(ctx, 'menu.open_app'), config.WEBAPP_URL!)
}

export function mainMenuKeyboard(ctx: MyContext): InlineKeyboard {
  return withOpenApp(new InlineKeyboard(), ctx)
    .text(t(ctx, 'menu.new_bill'), 'menu:new_bill')
    .row()
    .text(t(ctx, 'menu.contacts'), 'menu:contacts')
    .row()
    .text(t(ctx, 'menu.incoming'), 'menu:incoming')
    .text(t(ctx, 'menu.history'), 'menu:history')
    .row()
    .text(t(ctx, 'menu.settings'), 'menu:settings')
}

export function helpKeyboard(ctx: MyContext): InlineKeyboard {
  const kb = withOpenApp(new InlineKeyboard(), ctx)
  // /help is reachable before registration — no main menu to go back to yet.
  if (ctx.user) kb.text(t(ctx, 'menu.back'), 'menu:back')
  return kb
}

/** Actions for the "New Bill but no contacts yet" dead-end. */
export function noContactsKeyboard(ctx: MyContext): InlineKeyboard {
  return withOpenApp(new InlineKeyboard(), ctx)
    .text(t(ctx, 'contacts.add_button'), encode('contact', 'add', 'new'))
    .row()
    .text(t(ctx, 'menu.back'), 'menu:back')
}

// ─── Contacts ────────────────────────────────────────────────────────────────

export function contactListKeyboard(contacts: Contact[], ctx: MyContext): InlineKeyboard {
  const kb = new InlineKeyboard()
  for (const c of contacts) {
    const label = c.linked_user_id
      ? `${c.display_name}${t(ctx, 'contacts.linked')}`
      : c.display_name
    kb.text(label, encode('contact', 'view', c.id)).row()
  }
  kb.text(t(ctx, 'contacts.add_button'), encode('contact', 'add', 'new')).row()
  kb.text(t(ctx, 'menu.back'), 'menu:back')
  return kb
}

export function contactDetailKeyboard(contactId: string, ctx: MyContext): InlineKeyboard {
  return new InlineKeyboard()
    .text(t(ctx, 'contacts.delete_button'), encode('contact', 'delete', contactId))
    .row()
    .text(t(ctx, 'contacts.back_button'), encode('contact', 'list', 'all'))
}

export function contactAddSourceKeyboard(ctx: MyContext): InlineKeyboard {
  return new InlineKeyboard()
    .text(t(ctx, 'contacts.add_manual'), encode('contact', 'add_manual', 'x'))
    .row()
    .text(t(ctx, 'contacts.add_telegram'), encode('contact', 'add_telegram', 'x'))
    .row()
    .text(t(ctx, 'contacts.add_username'), encode('contact', 'add_username', 'x'))
    .row()
    .text(t(ctx, 'contacts.back_button'), encode('contact', 'list', 'all'))
}

export function contactSkipPhoneKeyboard(ctx: MyContext): InlineKeyboard {
  return new InlineKeyboard()
    .text(t(ctx, 'contacts.skip_phone'), encode('contact', 'skip_phone', 'now'))
    .text(t(ctx, 'contacts.cancel'), encode('contact', 'cancel', 'now'))
}

// ─── Bill wizard ─────────────────────────────────────────────────────────────

export function participantSelectKeyboard(
  selfContact: Contact,
  contacts: Contact[],
  selected: string[],
  ctx: MyContext
): InlineKeyboard {
  const kb = new InlineKeyboard()

  // "Me" entry — always first, unselected by default
  const selfChecked = selected.includes(selfContact.id) ? '☑️' : '☐'
  kb.text(
    `${selfChecked} ${t(ctx, 'bill.me_label', { name: selfContact.display_name })}`,
    encode('bill', 'toggle_participant', selfContact.id)
  ).row()

  for (const c of contacts) {
    const checked = selected.includes(c.id) ? '☑️' : '☐'
    kb.text(`${checked} ${c.display_name}`, encode('bill', 'toggle_participant', c.id)).row()
  }
  if (selected.length > 0) {
    kb.text(t(ctx, 'bill.done_button'), 'bill:participants_done')
  }
  return kb
}

export function itemShareKeyboard(
  participants: Contact[],
  selected: string[],
  ctx: MyContext
): InlineKeyboard {
  const kb = new InlineKeyboard()
  for (const c of participants) {
    const checked = selected.includes(c.id) ? '☑️' : '☐'
    kb.text(`${checked} ${c.display_name}`, encode('bill', 'toggle_share', c.id)).row()
  }
  kb.text(t(ctx, 'bill.select_all'), 'bill:shares_all').row()
  if (selected.length > 0) {
    kb.text(t(ctx, 'bill.done_button'), 'bill:shares_done')
  }
  return kb
}

export function itemNextKeyboard(ctx: MyContext): InlineKeyboard {
  return new InlineKeyboard()
    .text(t(ctx, 'bill.add_another'), 'bill:add_item')
    .text(t(ctx, 'bill.done_items'), 'bill:items_done')
}

export function serviceChargeKeyboard(ctx: MyContext): InlineKeyboard {
  return new InlineKeyboard()
    .text('0%', 'bill:service:0')
    .text('10%', 'bill:service:10')
    .text('12%', 'bill:service:12')
    .row()
    .text('15%', 'bill:service:15')
    .text(t(ctx, 'bill.service_custom'), 'bill:service:custom')
}

export function tipKeyboard(ctx: MyContext): InlineKeyboard {
  return new InlineKeyboard()
    .text(t(ctx, 'bill.tip_none'), 'bill:tip:0')
    .text('5 000', 'bill:tip:5000')
    .row()
    .text('10 000', 'bill:tip:10000')
    .text('15 000', 'bill:tip:15000')
    .row()
    .text(t(ctx, 'bill.tip_custom'), 'bill:tip:custom')
}

export function tipPayerKeyboard(
  participants: Contact[],
  selected: string | undefined,
  ctx: MyContext
): InlineKeyboard {
  const kb = new InlineKeyboard()
  // Default: the creator paid the tip. Selected when no explicit payer is set.
  const creatorMark = selected ? '' : '✅ '
  kb.text(`${creatorMark}${t(ctx, 'bill.tip_payer_creator')}`, encode('bill', 'tip_payer', 'creator')).row()
  for (const c of participants) {
    const mark = selected === c.id ? '✅ ' : ''
    kb.text(`${mark}${c.display_name}`, encode('bill', 'tip_payer', c.id)).row()
  }
  return kb
}

export function billReviewKeyboard(ctx: MyContext): InlineKeyboard {
  return new InlineKeyboard()
    .text(t(ctx, 'bill.edit_button'), 'bill:edit')
    .text(t(ctx, 'bill.send_button'), 'bill:send')
    .row()
    .text(t(ctx, 'bill.cancel_button'), 'bill:cancel')
}

export function receiptSkipKeyboard(ctx: MyContext): InlineKeyboard {
  // id segment is a throwaway ('x'); the decode util requires a non-empty 3rd part.
  return new InlineKeyboard()
    .text(t(ctx, 'split.receipt_skip'), encode('bill', 'receipt_skip', 'x'))
}

// ─── Payment / notification ───────────────────────────────────────────────────

export function confirmDisputeKeyboard(participantId: string, ctx: MyContext): InlineKeyboard {
  return new InlineKeyboard()
    .text(t(ctx, 'payment.confirm_button'), encode('bill', 'confirm', participantId))
    .text(t(ctx, 'payment.dispute_button'), encode('bill', 'dispute', participantId))
}

export function proofSkipKeyboard(participantId: string, ctx: MyContext): InlineKeyboard {
  // Short action token 'mps' (mark-paid skip) keeps the callback under 64 bytes.
  return new InlineKeyboard()
    .text(t(ctx, 'incoming.proof_skip'), encode('bill', 'mps', participantId))
}

// ─── Incoming ────────────────────────────────────────────────────────────────

export function incomingListKeyboard(
  items: Array<{ participantId: string; title: string }>,
  ctx: MyContext
): InlineKeyboard {
  const kb = new InlineKeyboard()
  for (const item of items) {
    kb.text(item.title, encode('incoming', 'view', item.participantId)).row()
  }
  kb.text(t(ctx, 'menu.back'), 'menu:back')
  return kb
}

export function incomingDetailKeyboard(
  participantId: string,
  status: string,
  ctx: MyContext
): InlineKeyboard {
  const kb = new InlineKeyboard()
  if (status === 'pending') {
    kb.text(t(ctx, 'incoming.mark_paid'), encode('bill', 'mark_paid', participantId)).row()
  }
  kb.text(t(ctx, 'incoming.back'), 'menu:incoming')
  return kb
}

// ─── History ─────────────────────────────────────────────────────────────────

export function historyTabKeyboard(activeTab: 'created' | 'received', ctx: MyContext): InlineKeyboard {
  const createdLabel = activeTab === 'created'
    ? `✅ ${t(ctx, 'history.tab_created')}`
    : t(ctx, 'history.tab_created')
  const receivedLabel = activeTab === 'received'
    ? `✅ ${t(ctx, 'history.tab_received')}`
    : t(ctx, 'history.tab_received')
  return new InlineKeyboard()
    .text(createdLabel, 'history:tab:created')
    .text(receivedLabel, 'history:tab:received')
    .row()
    .text(t(ctx, 'menu.back'), 'menu:back')
}

export function historyBillKeyboard(
  unpaidParticipants: Array<{ id: string; contactName: string }>,
  ctx: MyContext,
  editInApp?: { billId: string }
): InlineKeyboard {
  const kb = new InlineKeyboard()
  // "Edit in app" only when the Mini App is configured and the bill is still
  // editable (decided by the caller). Deep-links the app to the edit view.
  if (editInApp && config.WEBAPP_URL) {
    kb.webApp(
      t(ctx, 'bill.edit_in_app'),
      `${config.WEBAPP_URL}?startapp=edit_${editInApp.billId}`
    ).row()
  }
  for (const p of unpaidParticipants) {
    kb.text(`🔔 ${p.contactName}`, encode('bill', 'remind', p.id)).row()
  }
  kb.text(t(ctx, 'history.back'), 'menu:history')
  return kb
}

// ─── Settings ────────────────────────────────────────────────────────────────

export function settingsKeyboard(
  ctx: MyContext,
  currentLang: string,
  cards: Card[]
): InlineKeyboard {
  const mark = (lang: string) => currentLang === lang ? '✅ ' : ''
  const kb = new InlineKeyboard()
  for (const card of cards) {
    kb.text(
      `💳 ${cardDisplayLabel(card)}${card.is_default ? ' ⭐' : ''}`,
      encode('settings', 'card', card.id)
    ).row()
  }
  kb.text(t(ctx, 'settings.add_card'), 'settings:card_add:x').row()
  return kb
    .text(`${mark('uz')}🇺🇿 O'zbek`, 'settings:lang:uz')
    .text(`${mark('ru')}🇷🇺 Русский`, 'settings:lang:ru')
    .text(`${mark('en')}🇺🇸 English`, 'settings:lang:en')
    .row()
    .text(t(ctx, 'menu.back'), 'menu:back')
}

export function cardDetailKeyboard(ctx: MyContext, card: Card): InlineKeyboard {
  const kb = new InlineKeyboard()
  if (!card.is_default) {
    kb.text(t(ctx, 'settings.set_default'), encode('settings', 'card_default', card.id)).row()
  }
  return kb
    .text(t(ctx, 'settings.rename_card'), encode('settings', 'card_rename', card.id))
    .text(t(ctx, 'settings.delete_card'), encode('settings', 'card_del', card.id))
    .row()
    .text(t(ctx, 'contacts.back_button'), 'menu:settings')
}

// ─── Group keyboards ──────────────────────────────────────────────────────────
// Group keyboards use text (callback) and url buttons only. `web_app` buttons
// are rejected outside private chats, so the Mini App is reached here through a
// t.me link instead — see utils/deep-link.

/** Where "Open & finish" should send the creator for this split. */
export function splitAppUrl(ctx: MyContext, splitId: string): string {
  return miniAppLink(ctx.me.username, config.WEBAPP_SHORT_NAME, buildSplitPayload(splitId))
}

/** Private-chat link that registers an unregistered joiner, then returns them here. */
export function splitActivateUrl(ctx: MyContext, splitId: string): string {
  return startLink(ctx.me.username, buildSplitPayload(splitId))
}

export function splitCardKeyboard(
  ctx: MyContext,
  split: { id: string; status: string },
  opts: { hasUnregistered: boolean }
): InlineKeyboard | undefined {
  // A finished split keeps its text but loses its buttons: nothing about it can
  // still be acted on, and a dead button invites a pointless tap.
  if (split.status !== 'collecting' && split.status !== 'building') return undefined

  const kb = new InlineKeyboard()

  if (split.status === 'collecting') {
    kb.text(t(ctx, 'group.btn.join'), encode('g', 'j', split.id))
      .text(t(ctx, 'group.btn.leave'), encode('g', 'l', split.id))
      .row()
  }

  kb.url(t(ctx, 'group.btn.open'), splitAppUrl(ctx, split.id)).row()

  if (opts.hasUnregistered) {
    kb.url(t(ctx, 'group.btn.activate'), splitActivateUrl(ctx, split.id)).row()
  }

  kb.text(t(ctx, 'group.btn.cancel'), encode('g', 'x', split.id))
  return kb
}

export function paymentBoardKeyboard(ctx: MyContext, splitId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text(t(ctx, 'group.btn.paid'), encode('g', 'p', splitId))
    .text(t(ctx, 'group.btn.remind'), encode('g', 'r', splitId))
    .row()
    .url(t(ctx, 'group.btn.open_app'), splitAppUrl(ctx, splitId))
}

/** Sole button on the "you need an account first" reply. */
export function startBotKeyboard(ctx: MyContext): InlineKeyboard {
  return new InlineKeyboard().url(t(ctx, 'group.open_bot'), `https://t.me/${ctx.me.username}`)
}

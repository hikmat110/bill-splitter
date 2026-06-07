import { InlineKeyboard } from 'grammy'
import type { MyContext } from '../index'
import { t } from '../../i18n'
import { encode } from '../../utils/callback'
import type { Contact } from '../../db/schema'

export function mainMenuKeyboard(ctx: MyContext): InlineKeyboard {
  return new InlineKeyboard()
    .text(t(ctx, 'menu.new_bill'), 'menu:new_bill')
    .row()
    .text(t(ctx, 'menu.contacts'), 'menu:contacts')
    .row()
    .text(t(ctx, 'menu.incoming'), 'menu:incoming')
    .text(t(ctx, 'menu.history'), 'menu:history')
    .row()
    .text(t(ctx, 'menu.settings'), 'menu:settings')
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

export function billReviewKeyboard(ctx: MyContext): InlineKeyboard {
  return new InlineKeyboard()
    .text(t(ctx, 'bill.edit_button'), 'bill:edit')
    .text(t(ctx, 'bill.send_button'), 'bill:send')
    .row()
    .text(t(ctx, 'bill.cancel_button'), 'bill:cancel')
}

// ─── Payment / notification ───────────────────────────────────────────────────

export function markPaidKeyboard(participantId: string, ctx: MyContext): InlineKeyboard {
  return new InlineKeyboard()
    .text(t(ctx, 'incoming.mark_paid'), encode('bill', 'mark_paid', participantId))
}

export function confirmDisputeKeyboard(participantId: string, ctx: MyContext): InlineKeyboard {
  return new InlineKeyboard()
    .text(t(ctx, 'payment.confirm_button'), encode('bill', 'confirm', participantId))
    .text(t(ctx, 'payment.dispute_button'), encode('bill', 'dispute', participantId))
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
  ctx: MyContext
): InlineKeyboard {
  const kb = new InlineKeyboard()
  for (const p of unpaidParticipants) {
    kb.text(`🔔 ${p.contactName}`, encode('bill', 'remind', p.id)).row()
  }
  kb.text(t(ctx, 'history.back'), 'menu:history')
  return kb
}

// ─── Settings ────────────────────────────────────────────────────────────────

export function settingsKeyboard(ctx: MyContext, currentLang: string): InlineKeyboard {
  const mark = (lang: string) => currentLang === lang ? '✅ ' : ''
  return new InlineKeyboard()
    .text(t(ctx, 'settings.set_card'), 'settings:set_card:x')
    .row()
    .text(`${mark('uz')}🇺🇿 O'zbek`, 'settings:lang:uz')
    .text(`${mark('ru')}🇷🇺 Русский`, 'settings:lang:ru')
    .text(`${mark('en')}🇺🇸 English`, 'settings:lang:en')
    .row()
    .text(t(ctx, 'menu.back'), 'menu:back')
}

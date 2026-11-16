// Pure mapping from the validated Split-form body to the existing
// `CreateBillInput` shape consumed by `bill.service.createBill`. Unit-tested
// (incl. a round-trip through `computeSettlement` for the money invariant).

import type { CreateBillInput, UpdateBillInput } from '../services/bill.service'
import type { CreateBillBody, UpdateBillBody } from './schemas'

export function toCreateBillInput(
  body: CreateBillBody,
  creatorId: string,
  creatorSelfContactId?: string,
  // Already resolved + ownership-checked by the route (undefined→default card
  // needs the DB, so it can't happen in this pure mapper).
  resolvedCardId?: string | null
): CreateBillInput {
  const participants = new Set(body.participantContactIds)
  // Normalize the tip payer to "non-creator participant or null": the creator
  // paying is the default (null) and must never be credited, and a payer who
  // somehow isn't a participant is ignored.
  const rawPayer = body.tipPaidByContactId ?? null
  const tipPaidByContactId =
    rawPayer && rawPayer !== creatorSelfContactId && participants.has(rawPayer) ? rawPayer : null
  return {
    creatorId,
    title: body.title,
    servicePct: body.servicePct,
    serviceFixed: 0,
    tip: body.tip,
    tipPaidByContactId,
    cardId: resolvedCardId ?? null,
    participantContactIds: [...body.participantContactIds],
    receiptAttachmentId: body.receiptAttachmentId ?? null,
    receiptMime: body.receiptMime ?? null,
    items: body.items.map((item, index) => ({
      name: item.name,
      price: item.price,
      quantity: item.quantity,
      position: index,
      // Defensive: keep only sharers that are participants (schema enforces this too).
      shares: item.shareContactIds
        .filter((id) => participants.has(id))
        .map((id) => ({ contactId: id, units: item.unitsByContactId?.[id] ?? null })),
    })),
  }
}

export function toUpdateBillInput(
  body: UpdateBillBody,
  billId: string,
  creatorId: string,
  creatorSelfContactId?: string,
  resolvedCardId?: string | null
): UpdateBillInput {
  return { ...toCreateBillInput(body, creatorId, creatorSelfContactId, resolvedCardId), billId }
}

export interface GroupSplitShape {
  id: string
  title: string | null
  status: string
  receiptAttachmentId: string | null
  receiptMime: string | null
  /** Ready to seed the Split screen's participant selection. */
  participantContactIds: string[]
  members: { contactId: string | null; displayName: string; isRegistered: boolean }[]
}

/**
 * The group roster as the Mini App needs it. Deliberately omits chat_id and
 * telegram ids — the app has no use for them and they are other people's data.
 */
export function shapeGroupSplit(
  split: {
    id: string
    title: string | null
    status: string
    receipt_attachment_id: string | null
    receipt_mime: string | null
  },
  members: {
    contact_id: string | null
    display_name: string
    user_id: string | null
  }[]
): GroupSplitShape {
  return {
    id: split.id,
    title: split.title,
    status: split.status,
    receiptAttachmentId: split.receipt_attachment_id,
    receiptMime: split.receipt_mime,
    participantContactIds: members
      .map((m) => m.contact_id)
      .filter((id): id is string => id !== null),
    members: members.map((m) => ({
      contactId: m.contact_id,
      displayName: m.display_name,
      isRegistered: m.user_id !== null,
    })),
  }
}

import { and, eq, ne, desc, inArray, sql } from 'drizzle-orm'
import { db } from '../db/client'
import {
  bills,
  billItems,
  billItemShares,
  billParticipants,
  contacts,
  users,
} from '../db/schema'
import type { Bill, BillItem, BillParticipant, Contact, User } from '../db/schema'
import { computeSettlement, computeBreakdown } from '../utils/settlement'
import type { ItemSpec, ItemShare, ParticipantBreakdown } from '../utils/settlement'

export interface CreateBillItemInput {
  name: string
  /** Per-unit price; the line total is `price × quantity`. */
  price: number
  quantity: number
  position: number
  /** Sharers with optional explicit unit counts (null = equal split). */
  shares: ItemShare[]
}

export interface CreateBillInput {
  creatorId: string
  title: string
  items: CreateBillItemInput[]
  servicePct: number
  serviceFixed: number
  tip: number
  /** Contact who fronted the tip; null = creator paid it (default). */
  tipPaidByContactId?: string | null
  participantContactIds: string[]
  /** Optional main receipt/cheque photo (opaque attachment id + mime). */
  receiptAttachmentId?: string | null
  receiptMime?: string | null
}

export interface UpdateBillInput extends CreateBillInput {
  billId: string
}

/** Thrown by updateBill when the bill is locked (a participant already responded). */
export class BillNotEditableError extends Error {
  constructor() {
    super('Bill can no longer be edited')
    this.name = 'BillNotEditableError'
  }
}

/**
 * A bill is editable only while every non-creator participant is still
 * `pending`. The creator's own self-participant (contact linked to the creator)
 * is exempt — it never transitions. Pure, so the route can reuse it for a fast
 * 409 before the transactional re-check.
 */
export function isBillEditable(
  participants: { status: string; contact: { linked_user_id: string | null } }[],
  creatorId: string
): boolean {
  return participants.every(
    (p) => p.contact.linked_user_id === creatorId || p.status === 'pending'
  )
}

export interface BillParticipantWithContact extends BillParticipant {
  contact: Contact
}

export interface BillItemWithShares extends BillItem {
  shares: { contact: Contact; units: number | null }[]
}

export interface BillWithDetails {
  bill: Bill
  items: BillItemWithShares[]
  participants: BillParticipantWithContact[]
  creator: User
}

// Transaction handle type, inferred from db.transaction's callback param.
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

function settlementFor(input: CreateBillInput) {
  const itemSpecs: ItemSpec[] = input.items.map((it) => ({
    price: it.price,
    quantity: it.quantity,
    shares: it.shares,
  }))
  return computeSettlement({
    items: itemSpecs,
    servicePct: input.servicePct,
    serviceFixed: input.serviceFixed,
    tip: input.tip,
    tipPaidByContactId: input.tipPaidByContactId ?? null,
  })
}

/**
 * Insert a bill's items (+ shares) and participant rows. Shared by createBill
 * and updateBill so the persisted settlement is computed identically — any
 * divergence would break the money invariant.
 */
async function writeBillChildren(
  tx: Tx,
  billId: string,
  items: CreateBillItemInput[],
  shares: Map<string, number>
): Promise<void> {
  for (const item of items) {
    const [insertedItem] = await tx
      .insert(billItems)
      .values({
        bill_id: billId,
        name: item.name,
        price: item.price,
        quantity: item.quantity,
        position: item.position,
      })
      .returning()

    if (!insertedItem) throw new Error('Failed to insert bill item')

    if (item.shares.length > 0) {
      await tx.insert(billItemShares).values(
        item.shares.map((s) => ({
          bill_item_id: insertedItem.id,
          contact_id: s.contactId,
          units: s.units,
        }))
      )
    }
  }

  for (const [contactId, amount] of shares) {
    await tx.insert(billParticipants).values({
      bill_id: billId,
      contact_id: contactId,
      amount,
      status: 'pending',
    })
  }
}

export async function createBill(input: CreateBillInput): Promise<Bill> {
  if (input.items.length === 0) throw new Error('Bill must have at least one item')
  if (input.participantContactIds.length === 0) throw new Error('Bill must have at least one participant')

  const settlement = settlementFor(input)

  return db.transaction(async (tx) => {
    const [bill] = await tx
      .insert(bills)
      .values({
        creator_id: input.creatorId,
        title: input.title,
        subtotal: settlement.subtotal,
        service_pct: String(input.servicePct),
        service_fixed: input.serviceFixed,
        tip: input.tip,
        tip_paid_by_contact_id: input.tipPaidByContactId ?? null,
        total: settlement.total,
        status: 'sent',
        receipt_attachment_id: input.receiptAttachmentId ?? null,
        receipt_mime: input.receiptMime ?? null,
      })
      .returning()

    if (!bill) throw new Error('Failed to insert bill')

    await writeBillChildren(tx, bill.id, input.items, settlement.shares)

    return bill
  })
}

/**
 * Replace an existing bill's contents and recompute the split. Allowed only
 * while the bill is still fully editable (see isBillEditable) — re-checked
 * inside the transaction to avoid a TOCTOU race. Because every participant was
 * `pending`, deleting and recreating participant rows loses no payment state.
 * Note: this wipes notification_message_id; the caller must capture the old ids
 * beforehand to re-send (see resendBillNotifications).
 */
export async function updateBill(input: UpdateBillInput): Promise<Bill> {
  if (input.items.length === 0) throw new Error('Bill must have at least one item')
  if (input.participantContactIds.length === 0) throw new Error('Bill must have at least one participant')

  const settlement = settlementFor(input)

  return db.transaction(async (tx) => {
    const [bill] = await tx.select().from(bills).where(eq(bills.id, input.billId)).limit(1)
    if (!bill) throw new Error('Bill not found')

    const partRows = await tx
      .select({ participant: billParticipants, contact: contacts })
      .from(billParticipants)
      .innerJoin(contacts, eq(billParticipants.contact_id, contacts.id))
      .where(eq(billParticipants.bill_id, input.billId))
    const participants = partRows.map((r) => ({ ...r.participant, contact: r.contact }))
    if (!isBillEditable(participants, bill.creator_id)) throw new BillNotEditableError()

    const [updated] = await tx
      .update(bills)
      .set({
        title: input.title,
        subtotal: settlement.subtotal,
        service_pct: String(input.servicePct),
        service_fixed: input.serviceFixed,
        tip: input.tip,
        tip_paid_by_contact_id: input.tipPaidByContactId ?? null,
        total: settlement.total,
        status: 'sent',
        receipt_attachment_id: input.receiptAttachmentId ?? null,
        receipt_mime: input.receiptMime ?? null,
        updated_at: new Date(),
      })
      .where(eq(bills.id, input.billId))
      .returning()

    if (!updated) throw new Error('Failed to update bill')

    // Replace children: deleting items cascades their shares.
    await tx.delete(billItems).where(eq(billItems.bill_id, input.billId))
    await tx.delete(billParticipants).where(eq(billParticipants.bill_id, input.billId))
    await writeBillChildren(tx, input.billId, input.items, settlement.shares)

    return updated
  })
}

export async function getBillWithDetails(billId: string): Promise<BillWithDetails | null> {
  const billResult = await db
    .select()
    .from(bills)
    .where(eq(bills.id, billId))
    .limit(1)
  const bill = billResult[0]
  if (!bill) return null

  const creatorResult = await db
    .select()
    .from(users)
    .where(eq(users.id, bill.creator_id))
    .limit(1)
  const creator = creatorResult[0]
  if (!creator) return null

  const itemRows = await db
    .select()
    .from(billItems)
    .where(eq(billItems.bill_id, billId))
    .orderBy(billItems.position)

  const itemsWithShares: BillItemWithShares[] = []
  for (const item of itemRows) {
    const shareRows = await db
      .select({ contact: contacts, units: billItemShares.units })
      .from(billItemShares)
      .innerJoin(contacts, eq(billItemShares.contact_id, contacts.id))
      .where(eq(billItemShares.bill_item_id, item.id))
    itemsWithShares.push({ ...item, shares: shareRows })
  }

  const participantRows = await db
    .select({ participant: billParticipants, contact: contacts })
    .from(billParticipants)
    .innerJoin(contacts, eq(billParticipants.contact_id, contacts.id))
    .where(eq(billParticipants.bill_id, billId))

  return {
    bill,
    items: itemsWithShares,
    participants: participantRows.map((r) => ({ ...r.participant, contact: r.contact })),
    creator,
  }
}

/**
 * Per-participant itemized cost breakdown for a loaded bill: which items each
 * contact shared, their portion of each, and their service/tip/total. Keyed by
 * contact_id. Per-person totals equal the stored `bill_participants.amount`.
 */
export function getBillBreakdown(details: BillWithDetails): Map<string, ParticipantBreakdown> {
  const { perContact } = computeBreakdown({
    items: details.items.map((it) => ({
      name: it.name,
      price: it.price,
      quantity: it.quantity,
      shares: it.shares.map((s) => ({ contactId: s.contact.id, units: s.units })),
    })),
    servicePct: Number(details.bill.service_pct),
    serviceFixed: details.bill.service_fixed,
    tip: details.bill.tip,
    tipPaidByContactId: details.bill.tip_paid_by_contact_id,
  })
  return perContact
}

export async function listBillsCreatedBy(creatorId: string): Promise<Bill[]> {
  return db
    .select()
    .from(bills)
    .where(eq(bills.creator_id, creatorId))
    .orderBy(desc(bills.created_at))
}

export interface ParticipantBill {
  bill: Bill
  participant: BillParticipantWithContact
}

export async function listBillsForParticipant(userId: string): Promise<ParticipantBill[]> {
  const rows = await db
    .select({ bill: bills, participant: billParticipants, contact: contacts })
    .from(billParticipants)
    .innerJoin(contacts, eq(billParticipants.contact_id, contacts.id))
    .innerJoin(bills, eq(billParticipants.bill_id, bills.id))
    // Bills sent TO this user — never their own bills (a creator doesn't owe
    // themselves; their own share shows only as "spent" in the bill detail).
    .where(and(eq(contacts.linked_user_id, userId), ne(bills.creator_id, userId)))
    .orderBy(desc(bills.created_at))

  return rows.map((r) => ({
    bill: r.bill,
    participant: { ...r.participant, contact: r.contact },
  }))
}

export interface ParticipantWithContactAndBill extends BillParticipant {
  contact: Contact
  bill: Bill
}

export async function getParticipantById(
  participantId: string
): Promise<ParticipantWithContactAndBill | null> {
  const rows = await db
    .select({ participant: billParticipants, contact: contacts, bill: bills })
    .from(billParticipants)
    .innerJoin(contacts, eq(billParticipants.contact_id, contacts.id))
    .innerJoin(bills, eq(billParticipants.bill_id, bills.id))
    .where(eq(billParticipants.id, participantId))
    .limit(1)
  const row = rows[0]
  if (!row) return null
  return { ...row.participant, contact: row.contact, bill: row.bill }
}

export async function markParticipantPaid(
  participantId: string,
  proof?: { attachmentId: string; mime: string } | null
): Promise<BillParticipant> {
  const [updated] = await db
    .update(billParticipants)
    .set({
      status: 'marked_paid',
      marked_paid_at: new Date(),
      payment_proof_attachment_id: proof?.attachmentId ?? null,
      payment_proof_mime: proof?.mime ?? null,
    })
    .where(eq(billParticipants.id, participantId))
    .returning()
  if (!updated) throw new Error('Participant not found')
  return updated
}

/** Find the bill that references a main-receipt attachment id (for file authz). */
export async function findBillByReceiptAttachment(attachmentId: string): Promise<Bill | null> {
  const rows = await db
    .select()
    .from(bills)
    .where(eq(bills.receipt_attachment_id, attachmentId))
    .limit(1)
  return rows[0] ?? null
}

/** Find the participant (+ contact + bill) that references a proof attachment id. */
export async function findParticipantWithBillByProofAttachment(
  attachmentId: string
): Promise<ParticipantWithContactAndBill | null> {
  const rows = await db
    .select({ participant: billParticipants, contact: contacts, bill: bills })
    .from(billParticipants)
    .innerJoin(contacts, eq(billParticipants.contact_id, contacts.id))
    .innerJoin(bills, eq(billParticipants.bill_id, bills.id))
    .where(eq(billParticipants.payment_proof_attachment_id, attachmentId))
    .limit(1)
  const row = rows[0]
  if (!row) return null
  return { ...row.participant, contact: row.contact, bill: row.bill }
}

export async function confirmPayment(participantId: string): Promise<BillParticipant> {
  const [updated] = await db
    .update(billParticipants)
    .set({ status: 'confirmed', confirmed_at: new Date() })
    .where(eq(billParticipants.id, participantId))
    .returning()
  if (!updated) throw new Error('Participant not found')

  // Auto-settle bill if all participants confirmed. The creator's own
  // self-participant never "confirms" (they don't owe themselves), so it must
  // be excluded from this check or the bill would never settle.
  const pending = await db
    .select({ id: billParticipants.id })
    .from(billParticipants)
    .innerJoin(contacts, eq(billParticipants.contact_id, contacts.id))
    .innerJoin(bills, eq(billParticipants.bill_id, bills.id))
    .where(
      and(
        eq(billParticipants.bill_id, updated.bill_id),
        sql`${billParticipants.status} != 'confirmed'`,
        sql`(${contacts.linked_user_id} IS NULL OR ${contacts.linked_user_id} != ${bills.creator_id})`
      )
    )
    .limit(1)

  if (pending.length === 0) {
    await db
      .update(bills)
      .set({ status: 'settled', updated_at: new Date() })
      .where(eq(bills.id, updated.bill_id))
  }

  return updated
}

export async function disputePayment(participantId: string): Promise<BillParticipant> {
  const [updated] = await db
    .update(billParticipants)
    .set({ status: 'disputed' })
    .where(eq(billParticipants.id, participantId))
    .returning()
  if (!updated) throw new Error('Participant not found')
  return updated
}

export async function saveNotificationMessageId(
  participantId: string,
  messageId: bigint
): Promise<void> {
  await db
    .update(billParticipants)
    .set({ notification_message_id: messageId })
    .where(eq(billParticipants.id, participantId))
}

export async function remindParticipant(participantId: string): Promise<BillParticipant | null> {
  const rows = await db
    .select()
    .from(billParticipants)
    .where(eq(billParticipants.id, participantId))
    .limit(1)
  const participant = rows[0]
  if (!participant) return null

  if (participant.last_reminded_at) {
    const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000)
    if (participant.last_reminded_at > sixHoursAgo) return null
  }

  const [updated] = await db
    .update(billParticipants)
    .set({ last_reminded_at: new Date() })
    .where(eq(billParticipants.id, participantId))
    .returning()
  return updated ?? null
}

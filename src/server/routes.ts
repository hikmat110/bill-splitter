// Mini App API routes. Thin adapters over existing services — no business logic,
// no raw SQL. Authentication + user resolution happen here; pure validation /
// mapping / authz live in their own (tested) modules.

import { ZodError } from 'zod'
import type { Bot } from 'grammy'
import type { MyContext } from '../bot/index'
import type {
  Contact,
  User,
} from '../db/schema'
import {
  createBill,
  getBillWithDetails,
  getBillBreakdown,
  listBillsCreatedBy,
  listBillsForParticipant,
  getParticipantById,
  markParticipantPaid,
  confirmPayment,
  disputePayment,
} from '../services/bill.service'
import type { BillWithDetails, BillItemWithShares, BillParticipantWithContact } from '../services/bill.service'
import type { ParticipantBreakdown } from '../utils/settlement'
import { listContacts, addContact, findOrCreateSelfContact } from '../services/contact.service'
import { findById } from '../services/user.service'
import {
  sendBillNotifications,
  notifyCreatorOfPaymentMark,
  notifyParticipantConfirmed,
  notifyParticipantDisputed,
  sendReminder,
} from '../services/notification.service'
import { authenticate } from './auth'
import { json, error } from './json'
import { createBillSchema, createContactSchema, disputeSchema } from './schemas'
import { toCreateBillInput } from './mappers'
import { canManageBill, canMarkPaid } from './authz'

// ─── response shapers ──────────────────────────────────────────────────────────

function shapeContact(c: Contact) {
  return { id: c.id, displayName: c.display_name, phone: c.phone, linkedUserId: c.linked_user_id }
}

function shapeItem(it: BillItemWithShares) {
  return {
    id: it.id,
    name: it.name,
    price: it.price,
    quantity: it.quantity,
    position: it.position,
    shareContactIds: it.shares.map((s) => s.id),
  }
}

function shapeBreakdown(b: ParticipantBreakdown | undefined) {
  if (!b) return { items: [], base: 0, service: 0, tip: 0 }
  return {
    items: b.items.map((it) => ({ name: it.name, share: it.share })),
    base: b.base,
    service: b.service,
    tip: b.tip,
  }
}

function shapeParticipant(p: BillParticipantWithContact, breakdown?: ParticipantBreakdown) {
  return {
    id: p.id,
    contactId: p.contact_id,
    displayName: p.contact.display_name,
    linkedUserId: p.contact.linked_user_id,
    amount: p.amount,
    status: p.status,
    ...shapeBreakdown(breakdown),
  }
}

function shapeBillDetail(d: BillWithDetails) {
  const breakdown = getBillBreakdown(d)
  return {
    id: d.bill.id,
    title: d.bill.title,
    subtotal: d.bill.subtotal,
    servicePct: Number(d.bill.service_pct),
    serviceFixed: d.bill.service_fixed,
    tip: d.bill.tip,
    total: d.bill.total,
    status: d.bill.status,
    createdAt: d.bill.created_at,
    creator: {
      id: d.creator.id,
      firstName: d.creator.first_name,
      cardNumber: d.creator.card_number,
    },
    items: d.items.map(shapeItem),
    participants: d.participants.map((p) => shapeParticipant(p, breakdown.get(p.contact_id))),
  }
}

// ─── dispatcher ─────────────────────────────────────────────────────────────────

export async function handleApi(
  req: Request,
  url: URL,
  bot: Bot<MyContext>
): Promise<Response> {
  const auth = await authenticate(req)
  if ('response' in auth) return auth.response
  const user = auth.user

  // segments after "/api"
  const seg = url.pathname.split('/').filter(Boolean).slice(1)
  const method = req.method

  try {
    // GET /api/me
    if (method === 'GET' && seg[0] === 'me' && seg.length === 1) {
      return await getMe(user)
    }

    // /api/contacts
    if (seg[0] === 'contacts' && seg.length === 1) {
      if (method === 'GET') return await getContacts(user)
      if (method === 'POST') return await postContact(req, user)
    }

    // /api/bills ...
    if (seg[0] === 'bills') {
      if (seg.length === 1) {
        if (method === 'GET') return await getBills(user)
        if (method === 'POST') return await postBill(req, user, bot)
      }
      if (seg.length === 2 && method === 'GET') {
        return await getBill(user, seg[1]!)
      }
      // /api/bills/:id/participants/:pid/<action>
      if (seg.length === 5 && seg[2] === 'participants' && method === 'POST') {
        const pid = seg[3]!
        const action = seg[4]!
        if (action === 'remind') return await remind(user, pid, bot)
        if (action === 'confirm') return await confirm(user, pid, bot)
        if (action === 'dispute') return await dispute(req, user, pid, bot)
      }
    }

    // /api/participants/:pid/mark_paid
    if (
      seg[0] === 'participants' &&
      seg.length === 3 &&
      seg[2] === 'mark_paid' &&
      method === 'POST'
    ) {
      return await markPaid(user, seg[1]!, bot)
    }

    return error(404, 'Not found')
  } catch (e) {
    if (e instanceof ZodError) {
      return json({ error: 'Validation failed', issues: e.issues }, { status: 400 })
    }
    throw e
  }
}

// ─── handlers ─────────────────────────────────────────────────────────────────

async function getMe(user: User): Promise<Response> {
  // Lazily ensure a self-contact exists so "You" can be a bill participant.
  const self = await findOrCreateSelfContact(user.id, user.first_name)
  return json({
    id: user.id,
    firstName: user.first_name,
    lastName: user.last_name,
    username: user.username,
    languageCode: user.language_code,
    cardNumber: user.card_number,
    selfContactId: self.id,
  })
}

async function getContacts(user: User): Promise<Response> {
  const contacts = await listContacts(user.id)
  return json(contacts.map(shapeContact))
}

async function postContact(req: Request, user: User): Promise<Response> {
  const body = createContactSchema.parse(await req.json())
  try {
    const contact = await addContact(user.id, body.displayName, body.phone)
    return json(shapeContact(contact), { status: 201 })
  } catch {
    return error(409, 'Could not add contact — the name may already be in use')
  }
}

async function getBills(user: User): Promise<Response> {
  const createdBills = await listBillsCreatedBy(user.id)
  const created = []
  for (const b of createdBills) {
    const d = await getBillWithDetails(b.id)
    if (d) created.push(shapeBillDetail(d))
  }

  const incomingRows = await listBillsForParticipant(user.id)
  const creatorNames = new Map<string, string>()
  const incoming = []
  for (const r of incomingRows) {
    let creatorName = creatorNames.get(r.bill.creator_id)
    if (creatorName === undefined) {
      const creator = await findById(r.bill.creator_id)
      creatorName = creator?.first_name ?? ''
      creatorNames.set(r.bill.creator_id, creatorName)
    }
    // Recipient sees only their own itemization (what they're paying for).
    const d = await getBillWithDetails(r.bill.id)
    const own = d ? getBillBreakdown(d).get(r.participant.contact_id) : undefined
    incoming.push({
      bill: {
        id: r.bill.id,
        title: r.bill.title,
        total: r.bill.total,
        status: r.bill.status,
        createdAt: r.bill.created_at,
        creatorName,
      },
      participant: {
        id: r.participant.id,
        amount: r.participant.amount,
        status: r.participant.status,
        ...shapeBreakdown(own),
      },
    })
  }

  return json({ created, incoming })
}

async function getBill(user: User, billId: string): Promise<Response> {
  const d = await getBillWithDetails(billId)
  if (!d) return error(404, 'Bill not found')
  // Visible if the user created it or participates in it.
  const isCreator = d.bill.creator_id === user.id
  const isParticipant = d.participants.some((p) => p.contact.linked_user_id === user.id)
  if (!isCreator && !isParticipant) return error(403, 'Forbidden')

  const shaped = shapeBillDetail(d)
  if (isCreator) return json(shaped)

  // Recipient sees only their own share — redact others' participants/items.
  // Breakdown amounts stay correct because they were computed over the full bill.
  const own = shaped.participants.filter((p) => p.linkedUserId === user.id)
  const ownContactIds = new Set(own.map((p) => p.contactId))
  const items = shaped.items.filter((it) =>
    it.shareContactIds.some((id) => ownContactIds.has(id))
  )
  return json({ ...shaped, participants: own, items })
}

async function postBill(req: Request, user: User, bot: Bot<MyContext>): Promise<Response> {
  const body = createBillSchema.parse(await req.json())
  const bill = await createBill(toCreateBillInput(body, user.id))
  await sendBillNotifications(bot, bill.id, user.card_number)
  const d = await getBillWithDetails(bill.id)
  return json(d ? shapeBillDetail(d) : { id: bill.id }, { status: 201 })
}

async function markPaid(user: User, pid: string, bot: Bot<MyContext>): Promise<Response> {
  const participant = await getParticipantById(pid)
  if (!participant) return error(404, 'Participant not found')
  if (!canMarkPaid(user, participant)) return error(403, 'Forbidden')
  await markParticipantPaid(pid)
  await notifyCreatorOfPaymentMark(bot, pid)
  return json({ ok: true })
}

async function confirm(user: User, pid: string, bot: Bot<MyContext>): Promise<Response> {
  const participant = await getParticipantById(pid)
  if (!participant) return error(404, 'Participant not found')
  if (!canManageBill(user, participant.bill)) return error(403, 'Forbidden')
  await confirmPayment(pid)
  await notifyParticipantConfirmed(bot, pid)
  return json({ ok: true })
}

async function dispute(
  req: Request,
  user: User,
  pid: string,
  bot: Bot<MyContext>
): Promise<Response> {
  const participant = await getParticipantById(pid)
  if (!participant) return error(404, 'Participant not found')
  if (!canManageBill(user, participant.bill)) return error(403, 'Forbidden')
  const { reason } = disputeSchema.parse(await req.json())
  await disputePayment(pid)
  await notifyParticipantDisputed(bot, pid, reason)
  return json({ ok: true })
}

async function remind(user: User, pid: string, bot: Bot<MyContext>): Promise<Response> {
  const participant = await getParticipantById(pid)
  if (!participant) return error(404, 'Participant not found')
  if (!canManageBill(user, participant.bill)) return error(403, 'Forbidden')
  const ok = await sendReminder(bot, pid)
  return json({ ok })
}

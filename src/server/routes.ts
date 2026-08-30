// Mini App API routes. Thin adapters over existing services — no business logic,
// no raw SQL. Authentication + user resolution happen here; pure validation /
// mapping / authz live in their own (tested) modules.

import { ZodError } from 'zod'
import type { Bot } from 'grammy'
import type { MyContext } from '../bot/index'
import type {
  Card,
  Contact,
  User,
} from '../db/schema'
import {
  createBill,
  updateBill,
  deleteBill,
  setBillArchived,
  getBillWithDetails,
  getBillBreakdown,
  listBillsCreatedBy,
  listBillsForParticipant,
  getParticipantById,
  markParticipantPaid,
  confirmPayment,
  disputePayment,
  findBillByReceiptAttachment,
  findParticipantWithBillByProofAttachment,
  isBillEditable,
  BillNotEditableError,
} from '../services/bill.service'
import type { BillWithDetails, BillItemWithShares, BillParticipantWithContact } from '../services/bill.service'
import type { ParticipantBreakdown } from '../utils/settlement'
import {
  listContacts,
  addContact,
  addContactsByUsernames,
  findOrCreateSelfContact,
  findContactById,
  getBillsReferencingContact,
  getContactAvatarTelegramId,
  softDeleteContact,
  deleteContact,
} from '../services/contact.service'
import { getAvatarFile } from '../services/avatar.service'
import { findById, updateLanguage } from '../services/user.service'
import {
  listCards,
  findCardById,
  getDefaultCard,
  addCard,
  setDefaultCard,
  renameCard,
  deleteCard,
  CardLimitError,
} from '../services/card.service'
import { cardNetwork } from '../utils/format'
import {
  sendBillNotifications,
  resendBillNotifications,
  notifyBillDeleted,
  notifyCreatorOfPaymentMark,
  notifyParticipantConfirmed,
  notifyParticipantDisputed,
  notifyAdminsOfFeedback,
  sendReminder,
} from '../services/notification.service'
import {
  createFeedback,
  listFeedback,
  getFeedbackById,
  updateFeedbackStatus,
  findFeedbackAttachment,
  FeedbackLimitError,
} from '../services/feedback.service'
import type { FeedbackWithDetails } from '../services/feedback.service'
import {
  saveImage,
  readAttachment,
  deleteAttachment,
  StorageError,
} from '../services/storage.service'
import type { AllowedMime } from '../services/storage.service'
import { ReceiptScanError } from '../services/receipt-scan.service'
import { scanReceiptForUser, ScanLimitError } from '../services/scan-quota.service'
import { retryAfterSeconds } from '../utils/scan-quota'
import { config } from '../config'
import { authenticate } from './auth'
import { json, error } from './json'
import {
  createBillSchema,
  updateBillSchema,
  createCardSchema,
  updateCardSchema,
  updateMeSchema,
  createContactSchema,
  addContactsByUsernameSchema,
  disputeSchema,
  markPaidSchema,
  scanReceiptSchema,
  createFeedbackSchema,
  updateFeedbackSchema,
  feedbackCategorySchema,
  feedbackStatusSchema,
} from './schemas'
import { parseCardNumber } from '../utils/format'
import { parseUsernameList } from '../utils/username'
import { toCreateBillInput, toUpdateBillInput } from './mappers'
import { canManageBill, canMarkPaid, isAdmin } from './authz'

// ─── response shapers ──────────────────────────────────────────────────────────

function shapeContact(c: Contact) {
  return { id: c.id, displayName: c.display_name, phone: c.phone, linkedUserId: c.linked_user_id }
}

function shapeCard(c: Card) {
  return {
    id: c.id,
    number: c.number,
    label: c.label,
    network: cardNetwork(c.number),
    last4: c.number.slice(-4),
    isDefault: c.is_default,
  }
}

function shapeItem(it: BillItemWithShares) {
  const unitsByContactId: Record<string, number> = {}
  for (const s of it.shares) {
    if (s.units != null) unitsByContactId[s.contact.id] = s.units
  }
  return {
    id: it.id,
    name: it.name,
    price: it.price,
    quantity: it.quantity,
    position: it.position,
    shareContactIds: it.shares.map((s) => s.contact.id),
    ...(Object.keys(unitsByContactId).length > 0 ? { unitsByContactId } : {}),
  }
}

function shapeBreakdown(b: ParticipantBreakdown | undefined) {
  if (!b) return { items: [], base: 0, service: 0, tip: 0, tipPaid: 0 }
  return {
    items: b.items.map((it) => ({ name: it.name, share: it.share, units: it.units })),
    base: b.base,
    service: b.service,
    tip: b.tip,
    tipPaid: b.tipPaid,
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
    markedPaidAt: p.marked_paid_at,
    paymentProofAttachmentId: p.payment_proof_attachment_id,
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
    tipPaidByContactId: d.bill.tip_paid_by_contact_id,
    total: d.bill.total,
    status: d.bill.status,
    receiptAttachmentId: d.bill.receipt_attachment_id,
    receiptMime: d.bill.receipt_mime,
    archivedAt: d.bill.archived_at,
    createdAt: d.bill.created_at,
    // The card attached to THIS bill (not whatever the creator's default is now).
    cardId: d.bill.card_id,
    cardNumber: d.card?.number ?? null,
    creator: {
      id: d.creator.id,
      firstName: d.creator.first_name,
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
      return await getMe(user, bot)
    }

    // PATCH /api/me — profile updates (language); returns the fresh Me shape
    if (method === 'PATCH' && seg[0] === 'me' && seg.length === 1) {
      return await patchMe(req, user, bot)
    }

    // /api/contacts
    if (seg[0] === 'contacts' && seg.length === 1) {
      if (method === 'GET') return await getContacts(user)
      if (method === 'POST') return await postContact(req, user)
    }

    // POST /api/contacts/by-username — batch-add registered users by @handle
    if (
      seg[0] === 'contacts' &&
      seg.length === 2 &&
      seg[1] === 'by-username' &&
      method === 'POST'
    ) {
      return await postContactsByUsername(req, user)
    }

    // DELETE /api/contacts/:id[?force=1] — 409 with blocking bills unless forced
    if (seg[0] === 'contacts' && seg.length === 2 && method === 'DELETE') {
      return await deleteContactRoute(user, seg[1]!, url.searchParams.get('force') === '1')
    }

    // POST /api/cards — add a payment card (first one becomes the default)
    if (seg[0] === 'cards' && seg.length === 1 && method === 'POST') {
      return await postCard(req, user)
    }

    // /api/cards/:id — rename / set default / delete
    if (seg[0] === 'cards' && seg.length === 2) {
      if (method === 'PATCH') return await patchCard(req, user, seg[1]!)
      if (method === 'DELETE') return await deleteCardRoute(user, seg[1]!)
    }

    // POST /api/attachments — multipart image upload, returns { id, mime }
    if (seg[0] === 'attachments' && seg.length === 1 && method === 'POST') {
      return await postAttachment(req)
    }

    // POST /api/receipts/scan — extract items from an uploaded receipt via Gemini
    if (seg[0] === 'receipts' && seg[1] === 'scan' && seg.length === 2 && method === 'POST') {
      return await postReceiptScan(req, user)
    }

    // GET /api/files/:id — stream a stored image (auth + ownership enforced)
    if (seg[0] === 'files' && seg.length === 2 && method === 'GET') {
      return await getFile(user, seg[1]!)
    }

    // GET /api/avatars/:contactId — Telegram profile photo; 404 → initials
    if (seg[0] === 'avatars' && seg.length === 2 && method === 'GET') {
      return await getAvatar(seg[1]!, bot)
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
      if (seg.length === 2 && method === 'PATCH') {
        return await patchBill(req, user, seg[1]!, bot)
      }
      if (seg.length === 2 && method === 'DELETE') {
        return await deleteBillRoute(user, seg[1]!, bot)
      }
      // POST /api/bills/:id/archive | /unarchive
      if (
        seg.length === 3 &&
        method === 'POST' &&
        (seg[2] === 'archive' || seg[2] === 'unarchive')
      ) {
        return await setArchivedRoute(user, seg[1]!, seg[2] === 'archive')
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
      return await markPaid(req, user, seg[1]!, bot)
    }

    // /api/feedback — POST is user-level; GET/PATCH are admin-only (guarded in
    // the handlers, matching the per-handler authz style above)
    if (seg[0] === 'feedback') {
      if (seg.length === 1 && method === 'POST') return await postFeedback(req, user, bot)
      if (seg.length === 1 && method === 'GET') return await getFeedbackList(user, url)
      if (seg.length === 2 && method === 'GET') return await getFeedbackRoute(user, seg[1]!)
      if (seg.length === 2 && method === 'PATCH') return await patchFeedback(req, user, seg[1]!)
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

async function shapeMe(user: User, bot: Bot<MyContext>) {
  // Lazily ensure a self-contact exists so "You" can be a bill participant.
  const self = await findOrCreateSelfContact(user.id, user.first_name)
  return {
    id: user.id,
    firstName: user.first_name,
    lastName: user.last_name,
    username: user.username,
    phone: user.phone,
    languageCode: user.language_code,
    cards: (await listCards(user.id)).map(shapeCard),
    selfContactId: self.id,
    // Used by the Mini App to deep-link into the bot's native contact picker.
    // `botInfo` throws until the bot is initialized, so guard with isInited().
    botUsername: bot.isInited() ? bot.botInfo.username : null,
    isAdmin: isAdmin(user, config.ADMIN_TELEGRAM_IDS),
  }
}

async function getMe(user: User, bot: Bot<MyContext>): Promise<Response> {
  return json(await shapeMe(user, bot))
}

async function patchMe(req: Request, user: User, bot: Bot<MyContext>): Promise<Response> {
  const body = updateMeSchema.parse(await req.json())
  await updateLanguage(user.id, body.languageCode)
  // `user` was loaded before the update — patch the field for the response.
  return json(await shapeMe({ ...user, language_code: body.languageCode }, bot))
}

async function patchCard(req: Request, user: User, cardId: string): Promise<Response> {
  const body = updateCardSchema.parse(await req.json())
  // Both ops are ownership-checked in the service; not-found and not-owned are
  // indistinguishable (single 404, no existence leak).
  let card = null
  if (body.label !== undefined) {
    card = await renameCard(user.id, cardId, body.label)
    if (!card) return error(404, 'Card not found')
  }
  if (body.isDefault) {
    card = await setDefaultCard(user.id, cardId)
    if (!card) return error(404, 'Card not found')
  }
  return json(shapeCard(card!))
}

async function deleteCardRoute(user: User, cardId: string): Promise<Response> {
  // Deleting the default promotes the newest remaining card (in the service);
  // bills referencing the card keep working via FK SET NULL.
  const ok = await deleteCard(user.id, cardId)
  return ok ? json({ ok: true }) : error(404, 'Card not found')
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

async function deleteContactRoute(
  user: User,
  contactId: string,
  force: boolean
): Promise<Response> {
  const contact = await findContactById(contactId)
  if (!contact || contact.owner_id !== user.id || contact.deleted_at) {
    return error(404, 'Contact not found')
  }
  // The self-contact backs "You" on every bill — never deletable.
  if (contact.linked_user_id === user.id) return error(400, 'Cannot delete yourself')

  const blocking = await getBillsReferencingContact(contactId)
  if (blocking.length > 0 && !force) {
    return json(
      {
        error: 'Contact is used in bills',
        blockingBills: blocking.map((b) => ({
          id: b.id,
          title: b.title,
          status: b.status,
          createdAt: b.created_at,
        })),
      },
      { status: 409 }
    )
  }

  // Referenced contacts are only hidden (old bills keep the name); clean ones go.
  if (blocking.length > 0) await softDeleteContact(contactId)
  else await deleteContact(contactId)
  return json({ ok: true })
}

async function postContactsByUsername(req: Request, user: User): Promise<Response> {
  const body = addContactsByUsernameSchema.parse(await req.json())
  const handles = parseUsernameList(body.usernames)
  if (handles.length === 0) return error(400, 'Enter at least one username')
  const r = await addContactsByUsernames(user.id, handles)
  return json({
    // Newly created contacts (linked + name-only) — names, for a summary toast.
    added: [...r.linked, ...r.added],
    skipped: r.skipped,
    notFound: r.notFound,
    selfSkipped: r.selfSkipped,
  })
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
        receiptAttachmentId: r.bill.receipt_attachment_id,
        createdAt: r.bill.created_at,
        creatorName,
        cardNumber: d?.card?.number ?? null,
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

  // Creator and participants all see the full bill — items, everyone's
  // amounts and statuses. Splitting is between friends; transparency beats
  // redaction (and the payer legitimately wants to see who owes what).
  return json(shapeBillDetail(d))
}

/**
 * Resolve a bill payload's card reference: `undefined` = the creator's default
 * card (old clients that don't send the field keep today's behavior), `null` =
 * explicitly none, a uuid = that card — if it's really theirs. Not-found and
 * not-owned are indistinguishable (single 400, no existence leak).
 */
async function resolveBillCardId(
  user: User,
  bodyCardId: string | null | undefined
): Promise<{ cardId: string | null } | { response: Response }> {
  if (bodyCardId === undefined) return { cardId: (await getDefaultCard(user.id))?.id ?? null }
  if (bodyCardId === null) return { cardId: null }
  const card = await findCardById(bodyCardId)
  if (!card || card.user_id !== user.id) return { response: error(400, 'Invalid card') }
  return { cardId: card.id }
}

async function postCard(req: Request, user: User): Promise<Response> {
  const body = createCardSchema.parse(await req.json())
  const digits = parseCardNumber(body.number)
  if (!digits) return error(400, 'Card number must be 16 digits')
  try {
    const card = await addCard(user.id, digits, body.label ?? null)
    return json(shapeCard(card), { status: 201 })
  } catch (e) {
    if (e instanceof CardLimitError) return error(400, e.message)
    throw e
  }
}

async function postBill(req: Request, user: User, bot: Bot<MyContext>): Promise<Response> {
  const body = createBillSchema.parse(await req.json())
  const resolved = await resolveBillCardId(user, body.cardId)
  if ('response' in resolved) return resolved.response
  // Resolve the creator's own contact so a tip-payer of "the creator" is
  // normalized to null (default) rather than wrongly crediting their own share.
  const self = await findOrCreateSelfContact(user.id, user.first_name)
  const bill = await createBill(toCreateBillInput(body, user.id, self.id, resolved.cardId))
  await sendBillNotifications(bot, bill.id)
  const d = await getBillWithDetails(bill.id)
  return json(d ? shapeBillDetail(d) : { id: bill.id }, { status: 201 })
}

async function patchBill(
  req: Request,
  user: User,
  billId: string,
  bot: Bot<MyContext>
): Promise<Response> {
  const d = await getBillWithDetails(billId)
  if (!d) return error(404, 'Bill not found')
  if (!canManageBill(user, d.bill)) return error(403, 'Forbidden')
  // Fast, friendly 409 before doing any work (re-checked transactionally below).
  if (!isBillEditable(d.participants, d.bill.creator_id)) {
    return error(409, 'Bill can no longer be edited — someone has already responded')
  }

  const body = updateBillSchema.parse(await req.json())
  const resolved = await resolveBillCardId(user, body.cardId)
  if ('response' in resolved) return resolved.response
  const self = await findOrCreateSelfContact(user.id, user.first_name)

  // updateBill wipes participant rows (and their notification_message_id), so
  // capture what we need for the re-send and old-photo cleanup beforehand.
  const oldMessageIds = new Map<string, bigint>()
  for (const p of d.participants) {
    if (p.notification_message_id) oldMessageIds.set(p.contact_id, p.notification_message_id)
  }
  const oldReceiptId = d.bill.receipt_attachment_id
  const oldReceiptMime = d.bill.receipt_mime

  try {
    await updateBill(toUpdateBillInput(body, billId, user.id, self.id, resolved.cardId))
  } catch (e) {
    if (e instanceof BillNotEditableError) {
      return error(409, 'Bill can no longer be edited — someone has already responded')
    }
    throw e
  }

  await resendBillNotifications(bot, billId, oldMessageIds)

  // Best-effort cleanup of a replaced main photo.
  if (oldReceiptId && oldReceiptId !== body.receiptAttachmentId && oldReceiptMime) {
    await deleteAttachment(oldReceiptId, oldReceiptMime)
  }

  const updated = await getBillWithDetails(billId)
  return json(updated ? shapeBillDetail(updated) : { id: billId })
}

async function deleteBillRoute(
  user: User,
  billId: string,
  bot: Bot<MyContext>
): Promise<Response> {
  const d = await getBillWithDetails(billId)
  if (!d) return error(404, 'Bill not found')
  if (!canManageBill(user, d.bill)) return error(403, 'Forbidden')

  // Rewrite participants' Telegram notifications while the rows still exist.
  await notifyBillDeleted(bot, d)

  // Capture attachment refs; the files are cleaned up after the delete.
  const attachments: { id: string; mime: string }[] = []
  if (d.bill.receipt_attachment_id && d.bill.receipt_mime) {
    attachments.push({ id: d.bill.receipt_attachment_id, mime: d.bill.receipt_mime })
  }
  for (const p of d.participants) {
    if (p.payment_proof_attachment_id && p.payment_proof_mime) {
      attachments.push({ id: p.payment_proof_attachment_id, mime: p.payment_proof_mime })
    }
  }

  await deleteBill(billId)
  for (const a of attachments) {
    await deleteAttachment(a.id, a.mime)
  }
  return json({ ok: true })
}

async function setArchivedRoute(
  user: User,
  billId: string,
  archived: boolean
): Promise<Response> {
  const d = await getBillWithDetails(billId)
  if (!d) return error(404, 'Bill not found')
  if (!canManageBill(user, d.bill)) return error(403, 'Forbidden')
  await setBillArchived(billId, archived)
  const updated = await getBillWithDetails(billId)
  return json(updated ? shapeBillDetail(updated) : { ok: true })
}

// ─── attachments ────────────────────────────────────────────────────────────

async function postAttachment(req: Request): Promise<Response> {
  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) return error(400, 'No file provided')
  if (file.size > config.MAX_UPLOAD_BYTES) return error(413, 'Image too large')
  try {
    const stored = await saveImage(new Uint8Array(await file.arrayBuffer()), file.type)
    return json({ id: stored.id, mime: stored.mime }, { status: 201 })
  } catch (e) {
    if (e instanceof StorageError) {
      return error(e.code === 'too_large' ? 413 : 400, e.message)
    }
    throw e
  }
}

async function postReceiptScan(req: Request, user: User): Promise<Response> {
  const { attachmentId, mime } = scanReceiptSchema.parse(await req.json())
  // Read the image the caller just uploaded. Like postAttachment, this trusts the
  // opaque server-generated uuid rather than binding files to a user — there is no
  // referencing bill yet at scan time (matches the pre-save receipt flow).
  // Resolved before the quota check so a missing image never costs a scan.
  const found = await readAttachment(attachmentId, mime)
  if (!found) return error(404, 'Receipt image not found')
  const bytes = new Uint8Array(await found.file.arrayBuffer())
  try {
    return json(await scanReceiptForUser(user.id, bytes, mime as AllowedMime))
  } catch (e) {
    if (e instanceof ScanLimitError) {
      // Sibling keys on the error envelope, like the 409 blockingBills case: the
      // client reads them from ApiError.data to render "next scan at …".
      return json(
        {
          error: e.message,
          code: e.code,
          retryAt: e.retryAt.toISOString(),
          limit: e.limit,
          windowHours: e.windowHours,
        },
        { status: 429, headers: { 'retry-after': String(retryAfterSeconds(e.retryAt, new Date())) } }
      )
    }
    if (e instanceof ReceiptScanError) {
      if (e.code === 'not_configured') return error(503, 'Receipt scanning is not configured')
      return error(
        502,
        e.code === 'parse'
          ? 'Could not read the receipt — try a clearer photo'
          : 'Receipt scanning is temporarily unavailable'
      )
    }
    throw e
  }
}

async function getFile(user: User, id: string): Promise<Response> {
  // Resolve which row references this id, then authorize by that bill's
  // visibility rule. A 404 for unreferenced ids prevents probing orphan files.
  const bill = await findBillByReceiptAttachment(id)
  if (bill) {
    const d = await getBillWithDetails(bill.id)
    if (!d) return error(404, 'Not found')
    const canView =
      d.bill.creator_id === user.id ||
      d.participants.some((p) => p.contact.linked_user_id === user.id)
    if (!canView) return error(403, 'Forbidden')
    return streamAttachment(id, bill.receipt_mime)
  }

  const participant = await findParticipantWithBillByProofAttachment(id)
  if (participant) {
    // Same visibility rule as the bill itself: creator or any participant.
    const d = await getBillWithDetails(participant.bill.id)
    if (!d) return error(404, 'Not found')
    const canView =
      d.bill.creator_id === user.id ||
      d.participants.some((p) => p.contact.linked_user_id === user.id)
    if (!canView) return error(403, 'Forbidden')
    return streamAttachment(id, participant.payment_proof_mime)
  }

  const fb = await findFeedbackAttachment(id)
  if (fb) {
    // Feedback screenshots: visible to the uploader and to admins.
    const canView = fb.feedback.user_id === user.id || isAdmin(user, config.ADMIN_TELEGRAM_IDS)
    if (!canView) return error(403, 'Forbidden')
    return streamAttachment(id, fb.attachment.mime)
  }

  return error(404, 'Not found')
}

// ─── feedback ───────────────────────────────────────────────────────────────

function shapeFeedback(f: FeedbackWithDetails) {
  return {
    id: f.id,
    category: f.category,
    message: f.message,
    status: f.status,
    screen: f.screen,
    buildId: f.build_id,
    platform: f.platform,
    tgVersion: f.tg_version,
    language: f.language,
    createdAt: f.created_at,
    reporter: {
      firstName: f.reporter.first_name,
      lastName: f.reporter.last_name,
      username: f.reporter.username,
    },
    attachments: f.attachments.map((a) => ({
      attachmentId: a.attachment_id,
      mime: a.mime,
      isAutoCapture: a.is_auto_capture,
    })),
  }
}

async function postFeedback(
  req: Request,
  user: User,
  bot: Bot<MyContext>
): Promise<Response> {
  const body = createFeedbackSchema.parse(await req.json())
  let created
  try {
    created = await createFeedback(user.id, {
      category: body.category,
      message: body.message,
      screen: body.context.screen,
      buildId: body.context.buildId,
      platform: body.context.platform,
      tgVersion: body.context.tgVersion,
      language: body.context.language,
      attachments: body.attachments,
    })
  } catch (e) {
    if (e instanceof FeedbackLimitError) return error(429, 'Too many feedback submissions')
    throw e
  }
  // Best-effort DMs (each send already swallows its own errors).
  await notifyAdminsOfFeedback(bot, {
    category: created.feedback.category,
    message: created.feedback.message,
    screen: created.feedback.screen,
    buildId: created.feedback.build_id,
    platform: created.feedback.platform,
    tgVersion: created.feedback.tg_version,
    language: created.feedback.language,
    reporter: user,
    attachmentCount: created.attachments.length,
    attachments: created.attachments,
  })
  return json({ id: created.feedback.id }, { status: 201 })
}

async function getFeedbackList(user: User, url: URL): Promise<Response> {
  if (!isAdmin(user, config.ADMIN_TELEGRAM_IDS)) return error(403, 'Forbidden')
  const status = feedbackStatusSchema.safeParse(url.searchParams.get('status'))
  const category = feedbackCategorySchema.safeParse(url.searchParams.get('category'))
  const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0)
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit')) || 20))
  const { items, total } = await listFeedback({
    status: status.success ? status.data : undefined,
    category: category.success ? category.data : undefined,
    offset,
    limit,
  })
  return json({ items: items.map(shapeFeedback), total })
}

async function getFeedbackRoute(user: User, id: string): Promise<Response> {
  if (!isAdmin(user, config.ADMIN_TELEGRAM_IDS)) return error(403, 'Forbidden')
  const found = await getFeedbackById(id)
  if (!found) return error(404, 'Feedback not found')
  return json(shapeFeedback(found))
}

async function patchFeedback(req: Request, user: User, id: string): Promise<Response> {
  if (!isAdmin(user, config.ADMIN_TELEGRAM_IDS)) return error(403, 'Forbidden')
  const body = updateFeedbackSchema.parse(await req.json())
  const updated = await updateFeedbackStatus(id, body.status)
  if (!updated) return error(404, 'Feedback not found')
  const full = await getFeedbackById(id)
  return json(full ? shapeFeedback(full) : { ok: true })
}

/**
 * Telegram profile photo for a contact (or the self-contact). Deliberately
 * requires only authentication + a valid contact uuid: participants view
 * avatars of contacts owned by the bill creator, uuids aren't enumerable, and
 * the bytes are what Telegram already exposes to the bot under the subject's
 * own privacy settings. Unknown contact / no telegram id / no photo are one
 * uniform 404 — the endpoint is not a contact-existence oracle.
 */
async function getAvatar(contactId: string, bot: Bot<MyContext>): Promise<Response> {
  const telegramId = await getContactAvatarTelegramId(contactId)
  if (!telegramId) return error(404, 'Not found')
  const file = await getAvatarFile(bot.api, telegramId)
  if (!file) return error(404, 'Not found')
  return new Response(file, {
    headers: { 'content-type': 'image/jpeg', 'cache-control': 'private, max-age=86400' },
  })
}

async function streamAttachment(id: string, mime: string | null): Promise<Response> {
  if (!mime) return error(404, 'Not found')
  const r = await readAttachment(id, mime)
  if (!r) return error(404, 'Not found')
  return new Response(r.file, {
    headers: { 'content-type': r.mime, 'cache-control': 'private, max-age=86400' },
  })
}

async function markPaid(
  req: Request,
  user: User,
  pid: string,
  bot: Bot<MyContext>
): Promise<Response> {
  const participant = await getParticipantById(pid)
  if (!participant) return error(404, 'Participant not found')
  if (!canMarkPaid(user, participant)) return error(403, 'Forbidden')
  await markParticipantPaid(pid, await readProof(req))
  await notifyCreatorOfPaymentMark(bot, pid)
  return json({ ok: true })
}

/** Parse the optional proof-of-transfer from a mark-paid body. Tolerates an
 *  empty/invalid body (the common case — no proof attached). */
async function readProof(req: Request): Promise<{ attachmentId: string; mime: string } | null> {
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return null
  }
  const parsed = markPaidSchema.safeParse(raw)
  if (!parsed.success || !parsed.data.attachmentId || !parsed.data.mime) return null
  return { attachmentId: parsed.data.attachmentId, mime: parsed.data.mime }
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

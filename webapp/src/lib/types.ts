// Shared API response/request types — mirror the shapes built in src/server/routes.ts.

/** One of the user's payment cards, as shaped by the API. */
export interface UserCard {
  id: string
  number: string
  /** Custom name; display falls back to `${network} ••${last4}`. */
  label: string | null
  network: string
  last4: string
  isDefault: boolean
}

export interface Me {
  id: string
  firstName: string
  lastName: string | null
  username: string | null
  phone: string
  languageCode: string
  cards: UserCard[]
  selfContactId: string
  /** Bot handle (no `@`) for the native-contact-picker deep link; null if unknown. */
  botUsername: string | null
}

export interface ApiContact {
  id: string
  displayName: string
  phone: string | null
  linkedUserId: string | null
}

/** Response from POST /api/contacts/by-username — name arrays for a summary toast. */
export interface UsernameAddResult {
  added: string[]
  skipped: string[]
  notFound: string[]
  selfSkipped: boolean
}

export type ParticipantStatus = 'pending' | 'marked_paid' | 'confirmed' | 'disputed'
export type BillStatus = 'draft' | 'sent' | 'settled' | 'cancelled'

/** One item line as it applies to a single participant. */
export interface BreakdownItem {
  name: string
  share: number
  /** Explicit unit count this person took (multi-unit items only). */
  units?: number
}

/** Per-participant cost breakdown attached to participants by the API. */
export interface Breakdown {
  items: BreakdownItem[]
  base: number
  service: number
  tip: number
  /** Full tip this participant fronted (credit); 0 unless they paid the tip. */
  tipPaid: number
}

export interface BillParticipant extends Breakdown {
  id: string
  contactId: string
  displayName: string
  linkedUserId: string | null
  amount: number
  status: ParticipantStatus
  /** When they marked their share paid (awaiting confirmation), if ever. */
  markedPaidAt: string | null
  /** Proof-of-transfer photo the payer attached (creator-visible). */
  paymentProofAttachmentId: string | null
}

export interface BillItem {
  id: string
  name: string
  /** Per-unit price; the line total is `price × quantity`. */
  price: number
  quantity: number
  position: number
  shareContactIds: string[]
  /** Explicit per-person unit counts; sharers absent here split the remainder. */
  unitsByContactId?: Record<string, number>
}

export interface BillDetail {
  id: string
  title: string
  subtotal: number
  servicePct: number
  serviceFixed: number
  tip: number
  tipPaidByContactId: string | null
  total: number
  status: BillStatus
  /** Main receipt/cheque photo for the bill (participant-visible). */
  receiptAttachmentId: string | null
  receiptMime: string | null
  /** Set when the creator archived the bill (hidden from default lists). */
  archivedAt: string | null
  createdAt: string
  /** Card attached to THIS bill for paying (not the creator's current default). */
  cardId: string | null
  cardNumber: string | null
  creator: { id: string; firstName: string }
  items: BillItem[]
  participants: BillParticipant[]
}

/** A bill blocking a contact delete (the 409 payload of DELETE /api/contacts/:id). */
export interface BlockingBill {
  id: string
  title: string
  status: BillStatus
  createdAt: string
}

export interface IncomingBill {
  bill: {
    id: string
    title: string
    total: number
    status: BillStatus
    receiptAttachmentId: string | null
    createdAt: string
    creatorName: string
  }
  // Recipient's own itemization (what they're paying for).
  participant: { id: string; amount: number; status: ParticipantStatus } & Breakdown
}

export interface BillsResponse {
  created: BillDetail[]
  incoming: IncomingBill[]
}

export interface CreateBillPayload {
  title: string
  participantContactIds: string[]
  items: {
    name: string
    /** Per-unit price. */
    price: number
    quantity: number
    shareContactIds: string[]
    unitsByContactId?: Record<string, number>
  }[]
  servicePct: number
  tip: number
  tipPaidByContactId?: string | null
  /** Card to attach: absent = server picks the default card; null = none. */
  cardId?: string | null
  receiptAttachmentId?: string | null
  receiptMime?: string | null
}

// Editing replaces the whole bill, so the PATCH payload is the same shape.
export type UpdateBillPayload = CreateBillPayload

/** Response from POST /api/attachments. */
export interface AttachmentRef {
  id: string
  mime: string
}

/** One line item extracted from a receipt photo. */
export interface ScannedReceiptItem {
  name: string
  /** LINE total (quantity × unit price), not the unit price. */
  price: number
  /** Item count printed on the receipt, else 1. */
  quantity: number
}

/** Response from POST /api/receipts/scan — extracted receipt data to prefill a draft. */
export interface ScannedReceipt {
  items: ScannedReceiptItem[]
  /** Service charge as a money amount (UZS); 0 if none printed. */
  serviceAmount: number
  /** Printed service percentage if the receipt states one, else null. */
  servicePct: number | null
  /** Printed grand total — a soft sanity hint, not authoritative. */
  total: number | null
}

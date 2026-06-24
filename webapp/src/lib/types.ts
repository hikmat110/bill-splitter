// Shared API response/request types — mirror the shapes built in src/server/routes.ts.

export interface Me {
  id: string
  firstName: string
  lastName: string | null
  username: string | null
  languageCode: string
  cardNumber: string | null
  selfContactId: string
}

export interface ApiContact {
  id: string
  displayName: string
  phone: string | null
  linkedUserId: string | null
}

export type ParticipantStatus = 'pending' | 'marked_paid' | 'confirmed' | 'disputed'
export type BillStatus = 'draft' | 'sent' | 'settled' | 'cancelled'

/** One item line as it applies to a single participant. */
export interface BreakdownItem {
  name: string
  share: number
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
  /** Proof-of-transfer photo the payer attached (creator-visible). */
  paymentProofAttachmentId: string | null
}

export interface BillItem {
  id: string
  name: string
  price: number
  quantity: number
  position: number
  shareContactIds: string[]
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
  createdAt: string
  creator: { id: string; firstName: string; cardNumber: string | null }
  items: BillItem[]
  participants: BillParticipant[]
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
  items: { name: string; price: number; shareContactIds: string[] }[]
  servicePct: number
  tip: number
  tipPaidByContactId?: string | null
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
  price: number
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

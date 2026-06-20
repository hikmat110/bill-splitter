// Local "new bill" draft model used by the Split screen before it's sent.

export interface DraftItem {
  id: string
  name: string
  price: number
  who: string[] // participant (contact) ids sharing this item — equal split
}

export interface DraftBill {
  title: string
  participantIds: string[]
  items: DraftItem[]
  servicePct: number
  tip: number
  /** Contact id of whoever paid the tip; null = the creator (default). */
  tipPaidBy: string | null
  /** Main receipt photo: the uploaded attachment id + mime, null if none. */
  receiptAttachmentId: string | null
  receiptMime: string | null
  /** Transient local preview (object URL or /api/files/:id); never submitted. */
  receiptPreviewUrl?: string | null
  /** When set, this draft edits an existing bill (PATCH) rather than creating. */
  editingBillId?: string | null
}

export interface Person {
  id: string
  name: string
}

export function emptyDraft(): DraftBill {
  return {
    title: '',
    participantIds: [],
    items: [],
    servicePct: 0,
    tip: 0,
    tipPaidBy: null,
    receiptAttachmentId: null,
    receiptMime: null,
    receiptPreviewUrl: null,
    editingBillId: null,
  }
}

export function uid(): string {
  return 'x' + Math.random().toString(36).slice(2, 9)
}

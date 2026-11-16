// Local "new bill" draft model used by the Split screen before it's sent.

/** One sharer of a draft item. `units: null` = no explicit count — they split
 *  the unassigned remainder equally. */
export interface DraftWho {
  id: string
  units: number | null
}

export interface DraftItem {
  id: string
  name: string
  /** Per-unit price; the line total is `price × qty`. */
  price: number
  qty: number
  who: DraftWho[]
}

export interface DraftBill {
  title: string
  participantIds: string[]
  items: DraftItem[]
  servicePct: number
  tip: number
  /** Contact id of whoever paid the tip; null = the creator (default). */
  tipPaidBy: string | null
  /** Card shown to participants. undefined = my default card at send time;
   *  null = explicitly no card; string = a specific card id. */
  cardId?: string | null
  /** Main receipt photo: the uploaded attachment id + mime, null if none. */
  receiptAttachmentId: string | null
  receiptMime: string | null
  /** Transient local preview (object URL or /api/files/:id); never submitted. */
  receiptPreviewUrl?: string | null
  /** When set, this draft edits an existing bill (PATCH) rather than creating. */
  editingBillId?: string | null
  /** When set, this draft came from a Telegram group split and will attach to
   *  it on send. Never persisted — see draftStorage. */
  groupSplitId?: string | null
}

export interface Person {
  id: string
  name: string
  /** Registered-user link (contact is "on the bot"); optional — only the
   *  Profile friends list cares. */
  linkedUserId?: string | null
}

/** A fresh draft. The owner is pre-selected when their self-contact id is known:
 *  they're on their own bill by default, and it makes the scan / add-item
 *  buttons usable right away (both are gated on having a participant). Callers
 *  that don't know the id yet (first render, storage merge base) pass nothing. */
export function emptyDraft(selfContactId?: string | null): DraftBill {
  return {
    title: '',
    participantIds: selfContactId ? [selfContactId] : [],
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

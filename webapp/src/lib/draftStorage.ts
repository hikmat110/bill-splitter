// Persist the in-progress Split draft to localStorage so closing the mini-app
// doesn't lose it. Versioned: the stored shape must match the current DraftBill
// (v2 = qty/units items); anything else is discarded rather than migrated.
// Edit sessions (editingBillId) are intentionally never persisted — restoring a
// stale edit could clobber a bill someone has since responded to.

import { emptyDraft } from './draft'
import type { DraftBill } from './draft'

const VERSION = 2
const key = (userId: string) => `billsplit.draft.v${VERSION}.${userId}`

/** Nothing worth restoring: no title, people, items, or receipt. */
export function isDraftEmpty(d: DraftBill): boolean {
  return (
    d.title.trim() === '' &&
    d.participantIds.length === 0 &&
    d.items.length === 0 &&
    !d.receiptAttachmentId
  )
}

export function saveDraft(userId: string, draft: DraftBill): void {
  try {
    // The preview object URL dies with the session; the attachment id is enough
    // to re-derive the image via the authorized files endpoint.
    const { receiptPreviewUrl: _preview, ...rest } = draft
    localStorage.setItem(key(userId), JSON.stringify({ v: VERSION, draft: rest }))
  } catch {
    // Private mode / quota exceeded — the draft just won't persist.
  }
}

export function loadDraft(userId: string): DraftBill | null {
  try {
    const raw = localStorage.getItem(key(userId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as { v?: number; draft?: unknown }
    if (parsed.v !== VERSION || typeof parsed.draft !== 'object' || parsed.draft === null) {
      localStorage.removeItem(key(userId))
      return null
    }
    const d: DraftBill = {
      ...emptyDraft(),
      ...(parsed.draft as Partial<DraftBill>),
      receiptPreviewUrl: null,
      editingBillId: null,
    }
    if (!Array.isArray(d.participantIds) || !Array.isArray(d.items)) {
      localStorage.removeItem(key(userId))
      return null
    }
    return d
  } catch {
    return null
  }
}

export function clearDraft(userId: string): void {
  try {
    localStorage.removeItem(key(userId))
  } catch {
    // ignore
  }
}

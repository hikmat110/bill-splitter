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
}

export interface Person {
  id: string
  name: string
}

export function emptyDraft(): DraftBill {
  return { title: '', participantIds: [], items: [], servicePct: 0, tip: 0 }
}

export function uid(): string {
  return 'x' + Math.random().toString(36).slice(2, 9)
}

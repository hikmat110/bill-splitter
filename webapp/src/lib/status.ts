import type { ParticipantStatus } from './types'

export function statusLabel(s: ParticipantStatus): string {
  switch (s) {
    case 'pending':
      return 'Pending'
    case 'marked_paid':
      return 'Marked paid'
    case 'confirmed':
      return 'Confirmed'
    case 'disputed':
      return 'Disputed'
  }
}

export function pillClass(s: ParticipantStatus): string {
  if (s === 'confirmed') return 'pill-pos'
  if (s === 'disputed') return 'pill-neg'
  if (s === 'marked_paid') return 'pill-acc'
  return 'pill-mut'
}

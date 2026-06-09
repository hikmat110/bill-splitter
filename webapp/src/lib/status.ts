import type { I18nKey } from '../i18n'
import type { ParticipantStatus } from './types'

export function statusLabel(
  t: (key: I18nKey) => string,
  s: ParticipantStatus
): string {
  return t(`status.${s}`)
}

export function pillClass(s: ParticipantStatus): string {
  if (s === 'confirmed') return 'pill-pos'
  if (s === 'disputed') return 'pill-neg'
  if (s === 'marked_paid') return 'pill-acc'
  return 'pill-mut'
}

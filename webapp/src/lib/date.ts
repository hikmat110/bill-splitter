import type { I18nKey } from '../i18n'

type T = (key: I18nKey, vars?: Record<string, string | number>) => string

const DATE_LOCALE: Record<string, string> = { ru: 'ru-RU', uz: 'uz-UZ', en: 'en-US' }

export function prettyDate(t: T, lang: string, iso: string): string {
  const d = new Date(iso)
  const day = new Date(d)
  day.setHours(0, 0, 0, 0)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const diff = Math.round((today.getTime() - day.getTime()) / 86_400_000)
  if (diff === 0) return t('common.today')
  if (diff === 1) return t('common.yesterday')
  if (diff > 1 && diff < 7) return t('common.days_ago', { n: diff })
  return d.toLocaleDateString(DATE_LOCALE[lang] ?? 'en-US', { month: 'short', day: 'numeric' })
}

/** Local wall-clock time for a near-future instant: "14:05" if it falls on
 *  today, else "16 Jul, 14:05". Device zone = the user's (Tashkent). */
export function prettyTime(lang: string, iso: string): string {
  const d = new Date(iso)
  const sameDay = d.toDateString() === new Date().toDateString()
  return d.toLocaleString(DATE_LOCALE[lang] ?? 'en-US', {
    ...(sameDay ? {} : { month: 'short', day: 'numeric' }),
    hour: '2-digit',
    minute: '2-digit',
  })
}

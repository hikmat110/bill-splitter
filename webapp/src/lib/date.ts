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

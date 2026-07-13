import { ru } from './ru'
import { uz } from './uz'
import { en } from './en'
import type { Context } from 'grammy'

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] }

const locales: Record<string, DeepPartial<typeof ru>> = { ru, uz, en }

type Path<T, Prefix extends string = ''> = T extends object
  ? { [K in keyof T & string]: Path<T[K], Prefix extends '' ? K : `${Prefix}.${K}`> }[keyof T & string]
  : Prefix

export type I18nKey = Path<typeof ru>

function resolvePath(obj: Record<string, unknown>, path: string): string {
  const parts = path.split('.')
  let cur: unknown = obj
  for (const part of parts) {
    if (typeof cur !== 'object' || cur === null) return path
    cur = (cur as Record<string, unknown>)[part]
  }
  return typeof cur === 'string' ? cur : path
}

export function t(ctx: Context, key: I18nKey, vars?: Record<string, string>): string {
  // Prefer user's stored language preference over Telegram client language
  const storedLang = (ctx as { user?: { language_code?: string } }).user?.language_code
  const lang = storedLang ?? ctx.from?.language_code ?? 'uz'
  const locale = (locales[lang] ?? locales['uz']!) as Record<string, unknown>
  const fallback = locales['uz'] as Record<string, unknown>

  let text = resolvePath(locale, key) ?? resolvePath(fallback, key) ?? key

  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      text = text.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), v)
    }
  }
  return text
}

/** Minimal context shim carrying only a language, for t() callers outside a
 *  live update (boot-time API calls, notifications to other users). */
export function langCtx(lang: string): Context {
  return { from: { language_code: lang } } as unknown as Context
}

/** Translate without a live update context — for boot-time API calls and
 *  notifications where only the recipient's stored language is known. */
export function tLang(lang: string, key: I18nKey, vars?: Record<string, string>): string {
  return t(langCtx(lang), key, vars)
}

export function statusLabel(ctx: Context, status: string): string {
  const key = `status.${status}` as I18nKey
  return t(ctx, key)
}

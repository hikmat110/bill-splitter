import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { en } from './en'
import type { Dict } from './en'
import { ru } from './ru'
import { uz } from './uz'
import { setMoneyLang } from '../lib/currency'

const locales: Record<string, Dict> = { en, ru, uz }
const FALLBACK = 'uz'

// Dotted-path key autocomplete derived from the canonical `en` shape.
type Path<T, Prefix extends string = ''> = T extends object
  ? { [K in keyof T & string]: Path<T[K], Prefix extends '' ? K : `${Prefix}.${K}`> }[keyof T & string]
  : Prefix
export type I18nKey = Path<Dict>

type Vars = Record<string, string | number>

function resolvePath(obj: Record<string, unknown>, path: string): string | undefined {
  let cur: unknown = obj
  for (const part of path.split('.')) {
    if (typeof cur !== 'object' || cur === null) return undefined
    cur = (cur as Record<string, unknown>)[part]
  }
  return typeof cur === 'string' ? cur : undefined
}

export function translate(lang: string, key: string, vars?: Vars): string {
  const locale = locales[lang] ?? locales[FALLBACK]!
  const fallback = locales[FALLBACK]!
  let text =
    resolvePath(locale as Record<string, unknown>, key) ??
    resolvePath(fallback as Record<string, unknown>, key) ??
    key
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      text = text.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(v))
    }
  }
  return text
}

/** Pick a supported language code, falling back to `uz`. */
export function pickLang(code: string | undefined | null): string {
  return code && locales[code] ? code : FALLBACK
}

function initialLang(): string {
  return pickLang(window.Telegram?.WebApp?.initDataUnsafe?.user?.language_code)
}

type Ctx = {
  t: (key: I18nKey, vars?: Vars) => string
  lang: string
  setLang: (code: string | undefined | null) => void
}

const I18nCtx = createContext<Ctx>({
  t: (key) => key,
  lang: FALLBACK,
  setLang: () => {},
})

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState(initialLang)
  // Keep the non-React money() formatter in sync with the active language.
  setMoneyLang(lang)

  const setLang = useCallback((code: string | undefined | null) => {
    setLangState(pickLang(code))
  }, [])

  const value = useMemo<Ctx>(
    () => ({ t: (key, vars) => translate(lang, key, vars), lang, setLang }),
    [lang, setLang]
  )

  return <I18nCtx.Provider value={value}>{children}</I18nCtx.Provider>
}

export function useT(): Ctx {
  return useContext(I18nCtx)
}

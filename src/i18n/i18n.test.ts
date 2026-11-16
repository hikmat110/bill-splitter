import { describe, it, expect } from 'bun:test'
import { ru } from './ru'
import { uz } from './uz'
import { en } from './en'
import { t, langCtx } from './index'

/** Every leaf path in a locale object, e.g. "group.btn.join". */
function leafPaths(obj: unknown, prefix = ''): string[] {
  if (typeof obj !== 'object' || obj === null) return [prefix]
  return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) =>
    leafPaths(v, prefix ? `${prefix}.${k}` : k)
  )
}

const ruPaths = leafPaths(ru)

describe('locale parity', () => {
  // ru is canonical: I18nKey is derived from it, so a key missing elsewhere is
  // invisible to the type checker. This is the only thing that catches it.
  it.each([
    ['uz', uz],
    ['en', en],
  ])('%s defines every key ru does', (_name, locale) => {
    const own = new Set(leafPaths(locale))
    expect(ruPaths.filter((p) => !own.has(p))).toEqual([])
  })

  it('has no stray keys outside ru', () => {
    const own = new Set(ruPaths)
    expect([...leafPaths(uz), ...leafPaths(en)].filter((p) => !own.has(p))).toEqual([])
  })

  it('leaves no interpolation placeholder unfilled in a resolved string', () => {
    // Guards the {{bot}} / {{host}} style vars: a typo in a locale would
    // otherwise ship a literal "{{bot}}" to users.
    expect(t(langCtx('ru'), 'group.help', { bot: 'SplitBot' })).not.toContain('{{')
    expect(t(langCtx('uz'), 'group.help', { bot: 'SplitBot' })).not.toContain('{{')
    expect(t(langCtx('en'), 'group.help', { bot: 'SplitBot' })).not.toContain('{{')
  })
})

describe('fallback chain', () => {
  it('falls back to another locale instead of echoing the key path', () => {
    // An unknown language falls through to uz; the resolved value must be real
    // text, not the literal "group.btn.join".
    const out = t(langCtx('fr'), 'group.btn.join')
    expect(out).not.toBe('group.btn.join')
    expect(out.length).toBeGreaterThan(0)
  })
})

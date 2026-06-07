// Thin wrapper over the Telegram WebApp SDK with a graceful browser fallback
// (so the app still runs in a normal browser tab during development).

const wa = () => window.Telegram?.WebApp

export function initTelegram(): void {
  const app = wa()
  if (app) {
    app.ready()
    app.expand()
  }
}

export type ColorScheme = 'light' | 'dark'

export function getColorScheme(): ColorScheme {
  const app = wa()
  if (app) return app.colorScheme
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function onThemeChange(cb: (scheme: ColorScheme) => void): () => void {
  const app = wa()
  if (app) {
    const handler = () => cb(app.colorScheme)
    app.onEvent('themeChanged', handler)
    return () => app.offEvent('themeChanged', handler)
  }
  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  const handler = (e: MediaQueryListEvent) => cb(e.matches ? 'dark' : 'light')
  mq.addEventListener('change', handler)
  return () => mq.removeEventListener('change', handler)
}

export function getInitData(): string {
  return wa()?.initData ?? ''
}

export function isInTelegram(): boolean {
  return !!wa()?.initData
}

type Haptic = 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error'

export function haptic(type: Haptic = 'light'): void {
  const h = wa()?.HapticFeedback
  if (!h) return
  if (type === 'success' || type === 'warning' || type === 'error') {
    h.notificationOccurred(type)
  } else {
    h.impactOccurred(type)
  }
}

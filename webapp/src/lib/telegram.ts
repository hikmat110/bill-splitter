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

/**
 * Launch payload, from either source:
 *  - `initDataUnsafe.start_param` for a true `t.me/<bot>/<app>?startapp=…` deep link
 *  - the `?startapp=…` query the bot's web_app button preserves on the URL
 */
export function startParam(): string | null {
  const fromSdk = wa()?.initDataUnsafe?.start_param
  if (fromSdk) return fromSdk
  try {
    return new URLSearchParams(window.location.search).get('startapp')
  } catch {
    return null
  }
}

export function isInTelegram(): boolean {
  return !!wa()?.initData
}

/** Open a t.me link inside Telegram (e.g. a bot deep link). No-op in a browser. */
export function openTelegramLink(url: string): void {
  wa()?.openTelegramLink(url)
}

/** Native Telegram modal alert (always renders in the webview, unlike the CSS
 *  toast). Falls back to window.alert in a plain browser. */
export function showAlert(message: string): void {
  const app = wa()
  if (app?.showAlert) app.showAlert(message)
  else window.alert(message)
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

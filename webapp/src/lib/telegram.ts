// Thin wrapper over the Telegram WebApp SDK with a graceful browser fallback
// (so the app still runs in a normal browser tab during development).

const wa = () => window.Telegram?.WebApp

export function initTelegram(): void {
  const app = wa()
  if (!app) return
  app.ready()
  app.expand()
  // Swipe-down must not close/minimize the app — closing is only via the
  // explicit X control (Bot API 7.7+; older clients keep the default).
  if (app.isVersionAtLeast?.('7.7')) app.disableVerticalSwipes?.()
  // Always open truly fullscreen on phones (Bot API 8.0+). Desktop/web keep
  // the normal windowed layout — fullscreen there takes over the monitor.
  if ((app.platform === 'android' || app.platform === 'ios') && app.isVersionAtLeast?.('8.0')) {
    app.requestFullscreen?.()
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

/** Telegram client platform ('ios', 'android', 'tdesktop'…); 'browser' outside Telegram. */
export function getPlatform(): string {
  return wa()?.platform ?? 'browser'
}

/** Telegram Bot API version of the client; '' outside Telegram. */
export function getTgVersion(): string {
  return wa()?.version ?? ''
}

/** Open a t.me link inside Telegram (e.g. a bot deep link). No-op in a browser. */
export function openTelegramLink(url: string): void {
  wa()?.openTelegramLink(url)
}

/**
 * Show Telegram's native back button wired to `cb`; the returned cleanup hides
 * it and detaches the handler. No-op (still returns a cleanup) in a browser —
 * overlays keep their own in-header back chevron for that case.
 */
export function onBackButton(cb: () => void): () => void {
  const back = wa()?.BackButton
  if (!back) return () => {}
  back.onClick(cb)
  back.show()
  return () => {
    back.offClick(cb)
    back.hide()
  }
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

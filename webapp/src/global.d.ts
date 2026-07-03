// Minimal typings for the Telegram WebApp SDK (telegram-web-app.js), covering
// only what this app uses.

export {}

interface TelegramHapticFeedback {
  impactOccurred(style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft'): void
  notificationOccurred(type: 'error' | 'success' | 'warning'): void
  selectionChanged(): void
}

interface TelegramBackButton {
  isVisible: boolean
  show(): void
  hide(): void
  onClick(cb: () => void): void
  offClick(cb: () => void): void
}

interface TelegramMainButton {
  text: string
  isVisible: boolean
  isActive: boolean
  showProgress(leaveActive?: boolean): void
  hideProgress(): void
  setText(text: string): void
  show(): void
  hide(): void
  enable(): void
  disable(): void
  setParams(params: {
    text?: string
    color?: string
    text_color?: string
    is_active?: boolean
    is_visible?: boolean
  }): void
  onClick(cb: () => void): void
  offClick(cb: () => void): void
}

interface TelegramWebAppUser {
  id: number
  first_name?: string
  last_name?: string
  username?: string
  language_code?: string
}

interface TelegramWebApp {
  initData: string
  initDataUnsafe: { user?: TelegramWebAppUser; start_param?: string }
  colorScheme: 'light' | 'dark'
  themeParams: Record<string, string>
  isExpanded: boolean
  /** 'android' | 'ios' | 'tdesktop' | 'macos' | 'web' | 'weba' | 'unknown' */
  platform: string
  version: string
  isVersionAtLeast?(version: string): boolean
  ready(): void
  expand(): void
  /** Bot API 7.7+ — stop vertical swipes from closing/minimizing the app. */
  disableVerticalSwipes?(): void
  enableVerticalSwipes?(): void
  /** Bot API 8.0+ — true fullscreen (hides Telegram's header). */
  requestFullscreen?(): void
  exitFullscreen?(): void
  isFullscreen?: boolean
  setHeaderColor(color: string): void
  setBackgroundColor(color: string): void
  onEvent(event: string, cb: () => void): void
  offEvent(event: string, cb: () => void): void
  openTelegramLink(url: string): void
  showAlert(message: string, cb?: () => void): void
  HapticFeedback: TelegramHapticFeedback
  BackButton: TelegramBackButton
  MainButton: TelegramMainButton
}

declare global {
  interface Window {
    Telegram?: { WebApp: TelegramWebApp }
  }
}

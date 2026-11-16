import { haptic } from './telegram'

/** Copy with the standard feedback: success haptic + toast, or the "copy by
 *  hand" toast when the webview blocks programmatic clipboard access. */
export async function copyWithToast(
  text: string,
  toast: (msg: string, icon?: string) => void,
  messages: { copied: string; manual: string }
): Promise<void> {
  if (await copyText(text)) {
    haptic('success')
    toast(messages.copied, 'ti-copy')
  } else {
    toast(messages.manual, 'ti-alert-circle')
  }
}

/**
 * Copy text to the clipboard, resiliently: `navigator.clipboard` is undefined
 * or permission-blocked in some Telegram webviews, so fall back to the classic
 * hidden-textarea + execCommand path. Returns false when both fail — the
 * caller should then point the user at the selectable text.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // fall through to the legacy path
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.focus()
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

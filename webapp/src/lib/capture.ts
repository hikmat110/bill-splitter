import { domToBlob } from 'modern-screenshot'
import { MAX_UPLOAD } from './api'

// Longest we let a DOM capture run — foreignObject rendering can silently hang
// in some webviews, and the feedback form must open regardless.
const CAPTURE_TIMEOUT_MS = 4000
// Longest output edge in CSS pixels; keeps captured JPEGs in the ~100–300 KB range.
const MAX_DIMENSION = 1280

/**
 * Capture the current app screen (the `.tg-app` root) as a JPEG file, excluding
 * the feedback button itself. Returns null on any failure or timeout — callers
 * open the feedback form without a screenshot (graceful degrade; DOM capture is
 * known-flaky in some Telegram webviews).
 */
export async function captureScreen(): Promise<File | null> {
  const el = document.querySelector<HTMLElement>('.tg-app')
  if (!el) return null
  try {
    const scale = Math.min(1, MAX_DIMENSION / Math.max(el.clientWidth, el.clientHeight, 1))
    const blob = await Promise.race([
      domToBlob(el, {
        type: 'image/jpeg',
        quality: 0.85,
        scale,
        backgroundColor: getComputedStyle(el).backgroundColor,
        filter: (node) =>
          !(node instanceof Element && node.classList.contains('feedback-fab')),
      }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), CAPTURE_TIMEOUT_MS)),
    ])
    if (!blob || blob.size === 0 || blob.size > MAX_UPLOAD) return null
    return new File([blob], 'screenshot.jpg', { type: 'image/jpeg' })
  } catch {
    return null
  }
}

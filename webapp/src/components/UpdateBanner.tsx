// Stale-bundle detection. A Mini App session can outlive several deploys — the
// running bundle is whatever the webview loaded at launch — so the client asks
// the server which build it is serving now and offers a reload when the two
// disagree. See lib/version.ts for how those two values are produced.
//
// Note the limit: this only reaches clients whose old bundle still boots. A
// bundle whose hashed assets are gone never runs React at all, so nothing here
// renders — the cache headers in src/server/version.ts are what prevent that.

import { useCallback, useEffect, useRef, useState } from 'react'
import { BUILD, fetchServerBuildId, isStale, reloadForUpdate } from '../lib/version'
import { haptic } from '../lib/telegram'
import { useT } from '../i18n'

const KEY = 'billsplit.update.v1'
// Resuming a backgrounded app is when a deploy has realistically landed
// underfoot. Throttled so flipping between tabs isn't a poll.
const THROTTLE_MS = 5 * 60 * 1000

type UpdateState = { target: string; attempts: number; dismissed?: boolean }

// sessionStorage, not local: this state is about the bundle in this webview,
// and it must survive the reload it triggers. Storage can throw in a
// private-mode webview — the banner then just doesn't remember, which only
// costs an extra prompt.
function read(): UpdateState | null {
  try {
    const raw = sessionStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as UpdateState) : null
  } catch {
    return null
  }
}

function write(state: UpdateState | null): void {
  try {
    if (state) sessionStorage.setItem(KEY, JSON.stringify(state))
    else sessionStorage.removeItem(KEY)
  } catch {
    // ignore
  }
}

export function useUpdateCheck(): {
  target: string | null
  update: () => void
  dismiss: () => void
} {
  const [target, setTarget] = useState<string | null>(null)
  const lastCheck = useRef(0)

  const check = useCallback(async () => {
    lastCheck.current = Date.now()
    const server = await fetchServerBuildId()
    if (server === null || !isStale(BUILD.buildId, server)) {
      write(null)
      setTarget(null)
      return
    }
    const prev = read()
    // A genuinely new build earns a fresh prompt, even after an earlier dismiss.
    const state: UpdateState = prev?.target === server ? prev : { target: server, attempts: 0 }
    write(state)
    // Two reloads that didn't change the bundle mean dist itself is behind what
    // the client expects; more prompts can't fix that, so stop asking.
    setTarget(state.dismissed || state.attempts >= 2 ? null : server)
  }, [])

  useEffect(() => {
    // In dev the bundle comes from Vite while /health reports whatever stale
    // dist is on disk — a permanent false positive.
    if (import.meta.env.DEV) return
    void check()
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      if (Date.now() - lastCheck.current < THROTTLE_MS) return
      void check()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [check])

  const update = useCallback(() => {
    const prev = read()
    const to = prev?.target ?? target
    if (!to) return
    const attempts = (prev?.attempts ?? 0) + 1
    write({ ...prev, target: to, attempts })
    haptic('light')
    reloadForUpdate(to, attempts)
  }, [target])

  const dismiss = useCallback(() => {
    const prev = read()
    if (prev) write({ ...prev, dismissed: true })
    setTarget(null)
  }, [])

  return { target, update, dismiss }
}

/** One dismissible row above the tabbar. Deliberately not a toast (auto-hides,
 *  no action) or a native alert (blocking, OK-only, hostile mid-entry). */
export function UpdateBanner({
  onUpdate,
  onDismiss,
}: {
  onUpdate: () => void
  onDismiss: () => void
}) {
  const { t } = useT()
  return (
    <div
      className="row"
      style={{
        gap: 8,
        flexShrink: 0,
        margin: '0 12px 8px',
        padding: '9px 10px 9px 13px',
        borderRadius: 16,
        background: 'var(--accent-soft)',
        color: 'var(--accent-text)',
      }}
    >
      <i className="ti ti-refresh" style={{ fontSize: 18, flexShrink: 0 }} />
      <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 700 }}>{t('update.body')}</span>
      <button className="btn btn-sm btn-primary" onClick={onUpdate} style={{ flexShrink: 0 }}>
        {t('update.action')}
      </button>
      <button
        className="icon-btn"
        onClick={onDismiss}
        aria-label={t('common.cancel')}
        style={{ width: 32, height: 32, background: 'transparent', border: 0, color: 'inherit' }}
      >
        <i className="ti ti-x" style={{ fontSize: 16 }} />
      </button>
    </div>
  )
}

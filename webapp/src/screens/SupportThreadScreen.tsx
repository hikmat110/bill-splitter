import { useCallback, useEffect, useRef, useState } from 'react'
import { AuthImage } from '../components/AuthImage'
import { PhotoModal } from '../components/PhotoModal'
import { Empty, OverlayHeader } from '../components/common'
import { useToast } from '../components/Toast'
import { api, ApiError } from '../lib/api'
import { prettyTime } from '../lib/date'
import { haptic, onBackButton } from '../lib/telegram'
import { useT } from '../i18n'
import type { I18nKey } from '../i18n'
import type { AdminMessageErrorBody, AdminSendFailureCode, SupportMessage } from '../lib/types'

const PAGE = 50
const POLL_MS = 5000
/** Treat the list as "at the bottom" within this many px, for auto-scroll. */
const STICK_PX = 80

// Explicit map (not a template key) so I18nKey typing stays intact.
const DM_ERROR: Record<AdminSendFailureCode, I18nKey> = {
  blocked: 'admin.dm_blocked',
  chat_not_found: 'admin.dm_chat_not_found',
  rate_limited: 'admin.dm_rate_limited',
  send_failed: 'admin.dm_failed',
}

/** Merge a freshly polled page into what we already show, keyed by id so
 *  existing bubbles (and their loaded photos) are never recreated. */
function merge(prev: SupportMessage[], next: SupportMessage[]): SupportMessage[] {
  const byId = new Map(prev.map((m) => [m.id, m]))
  for (const m of next) byId.set(m.id, m)
  return [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

/** Admin-only support conversation with one user: the full thread plus a
 *  composer. Opened from the support inbox and from the user detail screen. */
export function SupportThreadScreen({
  userId,
  title,
  onClose,
}: {
  userId: string
  title: string
  onClose: () => void
}) {
  const { t, lang } = useT()
  const toast = useToast()
  const [items, setItems] = useState<SupportMessage[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [viewing, setViewing] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const stick = useRef(true)

  // Native back closes the photo first, then the thread.
  useEffect(
    () => onBackButton(viewing ? () => setViewing(null) : onClose),
    [viewing, onClose]
  )

  const applyPage = useCallback((page: SupportMessage[], more: boolean) => {
    const el = listRef.current
    stick.current = el
      ? el.scrollHeight - el.scrollTop - el.clientHeight < STICK_PX
      : true
    setItems((prev) => merge(prev, page))
    setHasMore(more)
  }, [])

  // Live thread: poll while the screen is open AND the webview is foregrounded.
  // Telegram backgrounds the webview without unmounting, so without the
  // visibility check this would keep firing forever. Chained setTimeout rather
  // than setInterval so a slow response cannot stack requests.
  useEffect(() => {
    let alive = true
    let timer: number | undefined

    const tick = async () => {
      if (!alive) return
      try {
        const res = await api.adminSupportThread(userId, { limit: PAGE })
        if (!alive) return
        applyPage(res.items, res.hasMore)
      } catch {
        // A transient failure must not kill the loop.
      } finally {
        if (alive) setLoading(false)
        if (alive && document.visibilityState === 'visible') {
          timer = window.setTimeout(() => void tick(), POLL_MS)
        }
      }
    }

    const onVisibility = () => {
      window.clearTimeout(timer)
      if (document.visibilityState === 'visible') void tick()
    }

    void tick()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      alive = false
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [userId, applyPage])

  // Follow new messages only when the admin was already at the bottom — someone
  // scrolled up reading history must not be yanked down.
  useEffect(() => {
    const el = listRef.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [items])

  const loadOlder = async () => {
    const oldest = items[0]
    if (!oldest) return
    try {
      const res = await api.adminSupportThread(userId, {
        before: oldest.createdAt,
        limit: PAGE,
      })
      stick.current = false
      setItems((prev) => merge(prev, res.items))
      setHasMore(res.hasMore)
    } catch (e) {
      toast(e instanceof Error ? e.message : t('common.something_wrong'), 'ti-alert-circle')
    }
  }

  const send = async () => {
    const body = text.trim()
    if (!body || sending) return
    setSending(true)
    try {
      const res = await api.adminMessage(userId, body)
      haptic('success')
      setText('')
      stick.current = true
      const sent = res.message
      if (sent) setItems((prev) => merge(prev, [sent]))
    } catch (e) {
      haptic('error')
      const data = e instanceof ApiError ? (e.data as Partial<AdminMessageErrorBody>) : undefined
      const key = data?.code ? DM_ERROR[data.code] : undefined
      toast(
        key ? t(key) : e instanceof Error ? e.message : t('admin.dm_failed'),
        'ti-alert-circle'
      )
      // The row exists server-side even when Telegram refused it — show it as an
      // undelivered bubble rather than losing what was typed.
      if (data?.message) {
        stick.current = true
        setItems((prev) => merge(prev, [data.message as SupportMessage]))
        setText('')
      }
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="overlay-screen">
      <OverlayHeader title={title} sub={t('admin.support_title')} onClose={onClose} />

      <div className="tg-scroll" ref={listRef} style={{ flex: 1 }}>
        {loading && items.length === 0 ? (
          <div className="thread">
            <div className="skel" style={{ height: 42, width: '60%', borderRadius: 16 }} />
            <div
              className="skel"
              style={{ height: 42, width: '50%', borderRadius: 16, alignSelf: 'flex-end' }}
            />
          </div>
        ) : items.length === 0 ? (
          <Empty icon="ti-messages-off" title={t('admin.support_no_messages')} />
        ) : (
          <div className="thread">
            {hasMore && (
              <button
                className="btn btn-sm"
                style={{ alignSelf: 'center' }}
                onClick={() => void loadOlder()}
              >
                {t('admin.support_load_older')}
              </button>
            )}
            {items.map((m) => {
              const failed = m.direction === 'out' && m.failureCode
              return (
                <div
                  key={m.id}
                  className={'bub ' + m.direction + (failed ? ' failed' : '')}
                >
                  {m.attachmentId && (
                    <AuthImage
                      attachmentId={m.attachmentId}
                      onClick={() => setViewing(m.attachmentId)}
                      style={{ width: 200, height: 200, objectFit: 'cover', display: 'block' }}
                    />
                  )}
                  {m.text && <div>{m.text}</div>}
                  <div className="bub-meta">
                    {prettyTime(lang, m.createdAt)}
                    {failed ? ` · ${t('admin.support_undelivered')}` : ''}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="composer">
        <textarea
          className="inp"
          rows={1}
          maxLength={4000}
          placeholder={t('admin.support_placeholder')}
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={sending}
        />
        <button
          className="btn btn-primary"
          style={{ padding: '11px 14px' }}
          disabled={sending || !text.trim()}
          onClick={() => void send()}
          aria-label={t('admin.support_send')}
        >
          <i className={sending ? 'ti ti-loader-2 spin' : 'ti ti-send'} />
        </button>
      </div>

      <PhotoModal attachmentId={viewing} onClose={() => setViewing(null)} />
    </div>
  )
}

import { useEffect, useState } from 'react'
import { Empty, OverlayHeader, Stat } from '../components/common'
import { Sheet } from '../components/Sheet'
import { useToast } from '../components/Toast'
import { api, ApiError } from '../lib/api'
import { prettyDate, relativeTime } from '../lib/date'
import { haptic, onBackButton, openTelegramLink } from '../lib/telegram'
import { useT } from '../i18n'
import type { I18nKey } from '../i18n'
import type {
  AdminMessageErrorBody,
  AdminSendFailureCode,
  AdminUserDetail as Detail,
} from '../lib/types'

// Explicit map (not a template key) so I18nKey typing stays intact.
const DM_ERROR: Record<AdminSendFailureCode, I18nKey> = {
  blocked: 'admin.dm_blocked',
  chat_not_found: 'admin.dm_chat_not_found',
  rate_limited: 'admin.dm_rate_limited',
  send_failed: 'admin.dm_failed',
}

/** Admin-only user detail: identity, activity counts, and a "message via the
 *  bot" sheet. Full-screen overlay opened from the Admin tab. */
export function AdminUserDetailScreen({
  userId,
  onClose,
}: {
  userId: string
  onClose: () => void
}) {
  const { t, lang } = useT()
  const toast = useToast()
  const [user, setUser] = useState<Detail | null>(null)
  const [loading, setLoading] = useState(true)
  const [dmOpen, setDmOpen] = useState(false)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)

  // Native back closes the sheet first, then the screen.
  useEffect(
    () => onBackButton(dmOpen ? () => setDmOpen(false) : onClose),
    [dmOpen, onClose]
  )

  useEffect(() => {
    let alive = true
    setLoading(true)
    api
      .adminUser(userId)
      .then((u) => {
        if (alive) setUser(u)
      })
      .catch((e) =>
        toast(e instanceof Error ? e.message : t('common.something_wrong'), 'ti-alert-circle')
      )
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [userId, t, toast])

  const send = async () => {
    const body = text.trim()
    if (!body || !user || sending) return
    setSending(true)
    try {
      await api.adminMessage(user.id, body)
      haptic('success')
      toast(t('admin.dm_sent'), 'ti-send')
      setText('')
      setDmOpen(false)
    } catch (e) {
      haptic('error')
      const code =
        e instanceof ApiError
          ? (e.data as Partial<AdminMessageErrorBody> | undefined)?.code
          : undefined
      const key = code ? DM_ERROR[code] : undefined
      toast(key ? t(key) : e instanceof Error ? e.message : t('admin.dm_failed'), 'ti-alert-circle')
    } finally {
      setSending(false)
    }
  }

  const name = user ? [user.firstName, user.lastName].filter(Boolean).join(' ') : ''
  const sub = user ? [user.username ? `@${user.username}` : null, user.phone].filter(Boolean).join(' · ') : ''

  return (
    <div className="overlay-screen">
      <OverlayHeader title={name || t('admin.users')} sub={sub} onClose={onClose} />

      <div className="tg-scroll" style={{ padding: '4px 16px 24px' }}>
        {loading && !user && (
          <div className="muted" style={{ textAlign: 'center', padding: 24, fontWeight: 600 }}>
            {t('common.loading')}
          </div>
        )}
        {!loading && !user && <Empty icon="ti-user-off" title={t('admin.search_empty')} />}

        {user && (
          <>
            <div className="card pop col" style={{ gap: 9, marginBottom: 14 }}>
              <Row label={t('admin.joined')} value={prettyDate(t, lang, user.createdAt)} />
              <Row
                label={t('admin.last_seen')}
                value={user.lastSeenAt ? relativeTime(t, lang, user.lastSeenAt) : t('admin.never')}
              />
              <Row label={t('admin.language')} value={user.languageCode} />
              <Row label={t('admin.telegram_id')} value={String(user.telegramId)} />
            </div>

            <div className="stat-grid" style={{ marginBottom: 14 }}>
              <Stat label={t('admin.bills_created')} value={user.counts.billsCreated} />
              <Stat label={t('admin.bills_received')} value={user.counts.billsReceived} />
              <Stat label={t('admin.scans_used')} value={user.counts.scansUsed} />
              <Stat label={t('admin.cards')} value={user.counts.cards} />
              <Stat label={t('admin.feedback_count')} value={user.counts.feedback} />
            </div>

            <div className="col" style={{ gap: 10 }}>
              <button
                className="btn btn-primary btn-block"
                onClick={() => {
                  haptic('light')
                  setDmOpen(true)
                }}
              >
                <i className="ti ti-send" /> {t('admin.dm_button')}
              </button>
              {user.username && (
                <button
                  className="btn btn-block"
                  onClick={() => openTelegramLink(`https://t.me/${user.username}`)}
                >
                  <i className="ti ti-brand-telegram" /> {t('admin.open_in_telegram')}
                </button>
              )}
            </div>
          </>
        )}
      </div>

      <Sheet
        open={dmOpen}
        onClose={() => {
          if (!sending) setDmOpen(false)
        }}
        title={t('admin.dm_title')}
      >
        <div className="col" style={{ gap: 12 }}>
          <div className="muted" style={{ fontSize: 13, lineHeight: 1.45 }}>
            {t('admin.dm_placeholder')}
          </div>
          <textarea
            className="inp"
            rows={5}
            maxLength={4000}
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={sending}
          />
          <button
            className="btn btn-primary btn-block"
            disabled={sending || !text.trim()}
            onClick={() => void send()}
          >
            <i className="ti ti-send" /> {sending ? t('admin.dm_sending') : t('admin.dm_send')}
          </button>
        </div>
      </Sheet>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="between" style={{ gap: 12 }}>
      <span className="muted" style={{ fontSize: 13.5, fontWeight: 600 }}>
        {label}
      </span>
      <span
        style={{
          fontSize: 13.5,
          fontWeight: 700,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {value}
      </span>
    </div>
  )
}

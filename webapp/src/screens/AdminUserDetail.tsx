import { useEffect, useState } from 'react'
import { Empty, OverlayHeader, Stat } from '../components/common'
import { useToast } from '../components/Toast'
import { api } from '../lib/api'
import { prettyDate, relativeTime } from '../lib/date'
import { haptic, onBackButton, openTelegramLink } from '../lib/telegram'
import { useT } from '../i18n'
import type { AdminUserDetail as Detail } from '../lib/types'
import { SupportThreadScreen } from './SupportThreadScreen'

/** Admin-only user detail: identity, activity counts, and a way into the
 *  support conversation with this user. Full-screen overlay from the Admin tab. */
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
  const [threadOpen, setThreadOpen] = useState(false)

  // onBackButton *adds* a listener, so two mounted screens would both fire on
  // one tap. While the thread is open it owns the back button.
  useEffect(() => {
    if (threadOpen) return
    return onBackButton(onClose)
  }, [threadOpen, onClose])

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
                  setThreadOpen(true)
                }}
              >
                <i className="ti ti-messages" /> {t('admin.support_open')}
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

      {threadOpen && user && (
        <SupportThreadScreen
          userId={user.id}
          title={name || t('admin.users')}
          onClose={() => setThreadOpen(false)}
        />
      )}
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

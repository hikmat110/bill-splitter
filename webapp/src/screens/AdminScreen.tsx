import { useCallback, useEffect, useState } from 'react'
import { BarChart } from '../components/BarChart'
import { Empty, SecTitle, Stat } from '../components/common'
import { useToast } from '../components/Toast'
import { api } from '../lib/api'
import { money } from '../lib/currency'
import { prettyDate, prettyTime, relativeTime } from '../lib/date'
import { haptic } from '../lib/telegram'
import { useT } from '../i18n'
import type { I18nKey } from '../i18n'
import type {
  AdminActivityItem,
  AdminStats,
  AdminUserSummary,
  ScanOutcome,
  ScanWindow,
} from '../lib/types'
import { AdminUserDetailScreen } from './AdminUserDetail'

const SCAN_VERB: Record<ScanOutcome, I18nKey> = {
  ok: 'admin.act_scan_ok',
  parse: 'admin.act_scan_parse',
  upstream: 'admin.act_scan_upstream',
  pending: 'admin.act_scan_pending',
}

/** Admin tab (me.isAdmin — the server 403s everyone else): usage overview,
 *  scan health, weekly trends, the feedback inbox entry, user lookup, and a
 *  recent-activity feed. Tab body, like Profile; user detail is an overlay. */
export function AdminScreen({ onOpenFeedbackAdmin }: { onOpenFeedbackAdmin: () => void }) {
  const { t, lang } = useT()
  const toast = useToast()
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [activity, setActivity] = useState<AdminActivityItem[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [results, setResults] = useState<AdminUserSummary[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [s, a] = await Promise.all([api.adminStats(), api.adminActivity(20)])
      setStats(s)
      setActivity(a.items)
    } catch (e) {
      toast(e instanceof Error ? e.message : t('common.something_wrong'), 'ti-alert-circle')
    } finally {
      setLoading(false)
    }
  }, [t, toast])

  useEffect(() => {
    void load()
  }, [load])

  // Debounced lookup; an empty query lists the most recent signups.
  useEffect(() => {
    let alive = true
    setSearching(true)
    const timer = window.setTimeout(
      () => {
        api
          .adminUsers(q.trim())
          .then((r) => {
            if (alive) setResults(r.items)
          })
          .catch(() => {
            if (alive) setResults([])
          })
          .finally(() => {
            if (alive) setSearching(false)
          })
      },
      q.trim() ? 300 : 0
    )
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [q])

  const u = stats?.overview.users
  const b = stats?.overview.bills
  const p = stats?.overview.participants
  const l = stats?.overview.languages
  const s = stats?.scans
  const quotaPct = s && s.dailyLimit > 0 ? Math.round((s.today / s.dailyLimit) * 100) : null

  const userName = (x: AdminUserSummary) => [x.firstName, x.lastName].filter(Boolean).join(' ')

  return (
    <>
      <div className="tg-scroll" style={{ padding: '4px 16px 24px' }}>
        {/* ── overview ── */}
        <SecTitle
          action={
            <button
              className="icon-btn"
              style={{ width: 34, height: 34, fontSize: 16 }}
              aria-label={t('admin.refresh')}
              disabled={loading}
              onClick={() => {
                haptic('light')
                void load()
              }}
            >
              <i className={'ti ti-refresh' + (loading ? ' spin' : '')} />
            </button>
          }
        >
          {t('admin.overview')}
        </SecTitle>

        {u && b ? (
          <div className="stat-grid pop" style={{ marginBottom: 12 }}>
            <Stat
              label={t('admin.users_total')}
              value={u.total}
              sub={`+${u.new7d} · 7d  ·  +${u.new30d} · 30d`}
            />
            <Stat
              label={t('admin.active_7d')}
              value={u.active7d}
              sub={`${u.active24h} · 24h  ·  ${u.active30d} · 30d`}
            />
            <Stat
              label={t('admin.bills_total')}
              value={b.total}
              sub={`${b.sent} ${t('admin.bills_sent').toLowerCase()} · ${b.settled} ${t('admin.bills_settled').toLowerCase()}`}
            />
            <Stat label={t('admin.volume')} value={money(b.volume)} />
          </div>
        ) : (
          <div className="stat-grid" style={{ marginBottom: 12 }}>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="skel" style={{ height: 78, borderRadius: 'var(--r-lg)' }} />
            ))}
          </div>
        )}

        {p && l && (
          <div className="card col" style={{ gap: 10, marginBottom: 18 }}>
            <div className="stat-lbl">{t('admin.funnel')}</div>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              <span className="pill pill-mut">{p.pending} · {t('status.pending')}</span>
              <span className="pill pill-acc">{p.marked_paid} · {t('status.marked_paid')}</span>
              <span className="pill pill-pos">{p.confirmed} · {t('status.confirmed')}</span>
              <span className={'pill ' + (p.disputed ? 'pill-neg' : 'pill-mut')}>
                {p.disputed} · {t('status.disputed')}
              </span>
            </div>
            <div className="stat-lbl" style={{ marginTop: 2 }}>{t('admin.languages')}</div>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              <span className="pill pill-mut">uz · {l.uz}</span>
              <span className="pill pill-mut">ru · {l.ru}</span>
              <span className="pill pill-mut">en · {l.en}</span>
              {l.other > 0 && <span className="pill pill-mut">? · {l.other}</span>}
            </div>
          </div>
        )}

        {/* ── scan health ── */}
        {s && (
          <>
            <SecTitle>{t('admin.scans')}</SecTitle>
            <div className="card" style={{ marginBottom: 18 }}>
              {!s.configured ? (
                <div className="muted" style={{ fontSize: 13.5, fontWeight: 600 }}>
                  {t('admin.scans_not_configured')}
                </div>
              ) : (
                <>
                  <div className="between">
                    <span className="stat-lbl">{t('admin.scans_today')}</span>
                    <span className="tnum" style={{ fontWeight: 800, fontSize: 15 }}>
                      {s.today}
                      {s.dailyLimit > 0 && (
                        <span className="muted3" style={{ fontWeight: 600 }}> / {s.dailyLimit}</span>
                      )}
                    </span>
                  </div>
                  {quotaPct !== null && (
                    <div className="meter" style={{ margin: '8px 0 6px' }}>
                      <i
                        className={quotaPct >= 100 ? 'full' : quotaPct >= 80 ? 'warn' : ''}
                        style={{ width: `${Math.min(100, quotaPct)}%` }}
                      />
                    </div>
                  )}
                  <div className="muted3" style={{ fontSize: 12, fontWeight: 600 }}>
                    {t('admin.scans_resets', { time: prettyTime(lang, s.resetsAt) })}
                  </div>

                  <ScanRow label={t('admin.scans_24h')} w={s.last24h} />
                  <ScanRow label={t('admin.scans_7d')} w={s.last7d} />

                  <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 12 }}>
                    <span className="pill pill-mut">{s.model}</span>
                    <span className={'pill ' + (s.relay ? 'pill-acc' : 'pill-mut')}>
                      {s.relay ? t('admin.scans_relay_on') : t('admin.scans_relay_off')}
                    </span>
                    <span className="pill pill-pos">{t('admin.scans_key_ok')}</span>
                  </div>
                </>
              )}
            </div>
          </>
        )}

        {/* ── trends ── */}
        {stats && (
          <>
            <SecTitle>{t('admin.trends')}</SecTitle>
            <div className="col" style={{ gap: 10, marginBottom: 18 }}>
              <BarChart data={stats.trends.signups} title={t('admin.trend_signups')} />
              <BarChart data={stats.trends.bills} title={t('admin.trend_bills')} />
            </div>
          </>
        )}

        {/* ── feedback inbox (the FeedbackAdminScreen overlay, owned by App) ── */}
        <button
          className="btn btn-block"
          style={{ justifyContent: 'space-between', marginBottom: 18 }}
          onClick={() => {
            haptic('light')
            onOpenFeedbackAdmin()
          }}
        >
          <span className="row" style={{ gap: 8 }}>
            <i className="ti ti-message-report" /> {t('feedback.admin_row')}
          </span>
          {stats && stats.feedback.open > 0 ? (
            <span className="pill pill-neg">{stats.feedback.open}</span>
          ) : (
            <i className="ti ti-chevron-right muted3" />
          )}
        </button>

        {/* ── users ── */}
        <SecTitle>{t('admin.users')}</SecTitle>
        <input
          className="inp"
          placeholder={t('admin.search_placeholder')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoCapitalize="none"
          autoCorrect="off"
          style={{ marginBottom: 10 }}
        />
        {!q.trim() && results && results.length > 0 && (
          <div className="muted3" style={{ fontSize: 12, fontWeight: 600, padding: '0 4px 8px' }}>
            {t('admin.recent_signups')}
          </div>
        )}
        <div className="col" style={{ gap: 8, marginBottom: 18 }}>
          {results?.map((x) => (
            <button
              key={x.id}
              className="card row"
              onClick={() => setSelected(x.id)}
              style={{
                gap: 10,
                textAlign: 'left',
                cursor: 'pointer',
                fontFamily: 'inherit',
                color: 'inherit',
                width: '100%',
                padding: 'calc(11px * var(--dens)) calc(13px * var(--dens))',
              }}
            >
              <div className="col" style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <span
                  style={{
                    fontWeight: 700,
                    fontSize: 14,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {userName(x) || x.phone}
                </span>
                <span className="muted3" style={{ fontSize: 12, fontWeight: 600 }}>
                  {[x.username ? `@${x.username}` : null, x.phone, x.languageCode]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </div>
              <span className="muted3" style={{ fontSize: 12, fontWeight: 600, flexShrink: 0 }}>
                {x.lastSeenAt ? relativeTime(t, lang, x.lastSeenAt) : prettyDate(t, lang, x.createdAt)}
              </span>
            </button>
          ))}
          {results && results.length === 0 && !searching && (
            <Empty icon="ti-user-search" title={t('admin.search_empty')} />
          )}
        </div>

        {/* ── recent activity ── */}
        <SecTitle>{t('admin.activity')}</SecTitle>
        {activity && activity.length === 0 && (
          <Empty icon="ti-activity" title={t('admin.activity_empty')} />
        )}
        {activity && activity.length > 0 && (
          <div className="card col" style={{ gap: 0, padding: '4px 0' }}>
            {activity.map((item, i) => (
              <ActivityRow
                key={`${item.kind}-${item.at}-${item.user.id}-${i}`}
                item={item}
                onOpen={() => setSelected(item.user.id)}
              />
            ))}
          </div>
        )}
        {!activity && loading && (
          <div className="col" style={{ gap: 8 }}>
            {[0, 1, 2].map((i) => (
              <div key={i} className="skel" style={{ height: 48 }} />
            ))}
          </div>
        )}
      </div>

      {/* user detail — full-screen overlay; sibling of the scroll area so it
          covers the tabbar (absolute inset:0 inside .tg-app) */}
      {selected && <AdminUserDetailScreen userId={selected} onClose={() => setSelected(null)} />}
    </>
  )
}

function ScanRow({ label, w }: { label: string; w: ScanWindow }) {
  const { t } = useT()
  const settled = w.ok + w.parse + w.upstream
  const pct = settled > 0 ? Math.round((w.ok / settled) * 100) : null
  const meta = [
    pct !== null ? t('admin.scans_rate', { pct }) : null,
    w.avgMs !== null ? t('admin.scans_avg', { s: (w.avgMs / 1000).toFixed(1) }) : null,
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <div style={{ marginTop: 12 }}>
      <div className="between" style={{ gap: 10 }}>
        <span style={{ fontWeight: 700, fontSize: 13.5 }}>{label}</span>
        <span className="muted tnum" style={{ fontSize: 12.5, fontWeight: 600 }}>
          {meta}
        </span>
      </div>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
        <span className="pill pill-pos">
          {w.ok} {t('admin.scans_ok')}
        </span>
        <span className="pill pill-mut">
          {w.parse} {t('admin.scans_parse')}
        </span>
        <span className={'pill ' + (w.upstream > 0 ? 'pill-neg' : 'pill-mut')}>
          {w.upstream} {t('admin.scans_upstream')}
        </span>
        {w.pending > 0 && (
          <span className="pill pill-acc">
            {w.pending} {t('admin.scans_pending')}
          </span>
        )}
      </div>
    </div>
  )
}

function ActivityRow({ item, onOpen }: { item: AdminActivityItem; onOpen: () => void }) {
  const { t, lang } = useT()
  let icon = 'ti-activity'
  let tone = ''
  let verb: string
  let detail: string | null = null
  switch (item.kind) {
    case 'signup':
      icon = 'ti-user-plus'
      tone = 'pos'
      verb = t('admin.act_signup')
      break
    case 'bill':
      icon = 'ti-receipt-2'
      tone = 'acc'
      verb = t('admin.act_bill')
      detail = `${item.title} · ${money(item.total)}`
      break
    case 'scan':
      icon = 'ti-scan'
      tone = item.status === 'ok' ? '' : item.status === 'pending' ? 'acc' : 'neg'
      verb = t(SCAN_VERB[item.status] ?? 'admin.act_scan_ok')
      detail = item.durationMs !== null ? `${(item.durationMs / 1000).toFixed(1)} s` : null
      break
    default:
      icon = 'ti-message-report'
      verb = t('admin.act_feedback')
      detail = t(`feedback.category_${item.category}`)
  }
  return (
    <button
      className="row"
      onClick={onOpen}
      style={{
        gap: 10,
        width: '100%',
        padding: '9px 14px',
        border: 'none',
        background: 'none',
        color: 'inherit',
        fontFamily: 'inherit',
        textAlign: 'left',
        cursor: 'pointer',
      }}
    >
      <span className={'act-ico ' + tone}>
        <i className={'ti ' + icon} />
      </span>
      <span className="col" style={{ flex: 1, minWidth: 0, gap: 1 }}>
        <span
          style={{
            fontSize: 13.5,
            fontWeight: 500,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          <b style={{ fontWeight: 700 }}>{item.user.firstName}</b> {verb}
        </span>
        {detail && (
          <span
            className="muted3"
            style={{
              fontSize: 12,
              fontWeight: 600,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {detail}
          </span>
        )}
      </span>
      <span className="muted3" style={{ fontSize: 11.5, fontWeight: 600, flexShrink: 0 }}>
        {relativeTime(t, lang, item.at)}
      </span>
    </button>
  )
}

import { useCallback, useEffect, useState } from 'react'
import { AuthImage } from '../components/AuthImage'
import { PhotoModal } from '../components/PhotoModal'
import { Segmented, Empty, OverlayHeader } from '../components/common'
import { useToast } from '../components/Toast'
import { api } from '../lib/api'
import { prettyDate } from '../lib/date'
import { haptic, onBackButton } from '../lib/telegram'
import { useT } from '../i18n'
import type { FeedbackCategory, FeedbackItem, FeedbackStatus } from '../lib/types'

const PAGE = 20

const CATEGORY_ICONS: Record<FeedbackCategory, string> = {
  bug: 'ti-bug',
  suggestion: 'ti-bulb',
  other: 'ti-message',
}

const STATUS_PILLS: Record<FeedbackStatus, string> = {
  open: 'pill-neg',
  in_progress: 'pill-mut',
  resolved: 'pill-pos',
}

/** Admin-only feedback inbox: list with status/category filters, inline detail
 *  with screenshots, and status changes. Reached from Profile (me.isAdmin). */
export function FeedbackAdminScreen({ onClose }: { onClose: () => void }) {
  const { t, lang } = useT()
  const toast = useToast()
  const [status, setStatus] = useState<'all' | FeedbackStatus>('open')
  const [category, setCategory] = useState<'all' | FeedbackCategory>('all')
  const [items, setItems] = useState<FeedbackItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<FeedbackItem | null>(null)
  const [viewing, setViewing] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Native back closes the photo, then the detail, then the whole screen.
  useEffect(
    () =>
      onBackButton(
        viewing ? () => setViewing(null) : selected ? () => setSelected(null) : onClose
      ),
    [viewing, selected, onClose]
  )

  const load = useCallback(
    async (offset: number) => {
      setLoading(true)
      try {
        const res = await api.feedbackList({
          status: status === 'all' ? undefined : status,
          category: category === 'all' ? undefined : category,
          offset,
          limit: PAGE,
        })
        setItems((prev) => (offset === 0 ? res.items : [...prev, ...res.items]))
        setTotal(res.total)
      } catch (e) {
        toast(e instanceof Error ? e.message : t('common.something_wrong'), 'ti-alert-circle')
      } finally {
        setLoading(false)
      }
    },
    [status, category, t, toast]
  )

  useEffect(() => {
    void load(0)
  }, [load])

  const changeStatus = async (next: FeedbackStatus) => {
    if (!selected || next === selected.status || busy) return
    setBusy(true)
    try {
      const updated = await api.updateFeedbackStatus(selected.id, next)
      setSelected(updated)
      setItems((prev) => prev.map((f) => (f.id === updated.id ? updated : f)))
      haptic('success')
      toast(t('feedback.status_updated'), 'ti-check')
    } catch (e) {
      toast(e instanceof Error ? e.message : t('common.something_wrong'), 'ti-alert-circle')
    } finally {
      setBusy(false)
    }
  }

  const reporterName = (f: FeedbackItem) =>
    [f.reporter.firstName, f.reporter.lastName].filter(Boolean).join(' ') +
    (f.reporter.username ? ` · @${f.reporter.username}` : '')

  return (
    <div className="overlay-screen">
      <OverlayHeader
        title={t('feedback.admin_title')}
        sub={selected ? reporterName(selected) : t('feedback.admin_count', { n: String(total) })}
        onClose={selected ? () => setSelected(null) : onClose}
      />

      {selected ? (
        <div className="tg-scroll" style={{ padding: '4px 16px 24px' }}>
          {/* detail */}
          <div className="card pop" style={{ marginBottom: 14 }}>
            <div className="row" style={{ gap: 8, marginBottom: 10 }}>
              <i
                className={'ti ' + CATEGORY_ICONS[selected.category]}
                style={{ fontSize: 18, color: 'var(--accent)' }}
              />
              <span style={{ fontWeight: 700, fontSize: 14 }}>
                {t(`feedback.category_${selected.category}`)}
              </span>
              <span
                className={'pill ' + STATUS_PILLS[selected.status]}
                style={{ marginLeft: 'auto' }}
              >
                {t(`feedback.status_${selected.status}`)}
              </span>
            </div>
            <div style={{ fontSize: 14.5, lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>
              {selected.message}
            </div>
            <div className="muted3" style={{ fontSize: 12, fontWeight: 600, marginTop: 12 }}>
              {[
                prettyDate(t, lang, selected.createdAt),
                selected.screen,
                selected.buildId,
                `${selected.platform} ${selected.tgVersion}`.trim(),
                selected.language,
              ]
                .filter(Boolean)
                .join(' · ')}
            </div>
            {selected.attachments.length > 0 && (
              <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
                {selected.attachments.map((a) => (
                  <AuthImage
                    key={a.attachmentId}
                    attachmentId={a.attachmentId}
                    onClick={() => setViewing(a.attachmentId)}
                    style={{ width: 72, height: 72, borderRadius: 10 }}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="sec-title">{t('feedback.set_status')}</div>
          <Segmented
            value={selected.status}
            onChange={(v) => void changeStatus(v)}
            options={(['open', 'in_progress', 'resolved'] as const).map((s) => ({
              value: s,
              label: t(`feedback.status_${s}`),
            }))}
          />
        </div>
      ) : (
        <div className="tg-scroll" style={{ padding: '4px 16px 24px' }}>
          {/* filters */}
          <div className="col" style={{ gap: 8, marginBottom: 14 }}>
            <Segmented
              value={status}
              onChange={setStatus}
              options={[
                { value: 'all', label: t('feedback.filter_all') },
                ...(['open', 'in_progress', 'resolved'] as const).map((s) => ({
                  value: s as 'all' | FeedbackStatus,
                  label: t(`feedback.status_${s}`),
                })),
              ]}
            />
            <Segmented
              value={category}
              onChange={setCategory}
              options={[
                { value: 'all', label: t('feedback.filter_all') },
                ...(['bug', 'suggestion', 'other'] as const).map((c) => ({
                  value: c as 'all' | FeedbackCategory,
                  label: t(`feedback.category_${c}`),
                })),
              ]}
            />
          </div>

          {/* list */}
          <div className="col" style={{ gap: 10 }}>
            {items.map((f) => (
              <button
                key={f.id}
                className="card"
                onClick={() => setSelected(f)}
                style={{
                  textAlign: 'left',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  color: 'inherit',
                  width: '100%',
                }}
              >
                <div className="row" style={{ gap: 8 }}>
                  <i
                    className={'ti ' + CATEGORY_ICONS[f.category]}
                    style={{ fontSize: 17, color: 'var(--accent)', flexShrink: 0 }}
                  />
                  <span
                    style={{
                      fontWeight: 700,
                      fontSize: 13.5,
                      flex: 1,
                      minWidth: 0,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {reporterName(f)}
                  </span>
                  <span className={'pill ' + STATUS_PILLS[f.status]} style={{ flexShrink: 0 }}>
                    {t(`feedback.status_${f.status}`)}
                  </span>
                </div>
                <div
                  className="muted"
                  style={{
                    fontSize: 13.5,
                    fontWeight: 500,
                    marginTop: 6,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {f.message}
                </div>
                <div className="row" style={{ gap: 8, marginTop: 6 }}>
                  <span className="muted3" style={{ fontSize: 12, fontWeight: 600 }}>
                    {prettyDate(t, lang, f.createdAt)} · {f.screen}
                  </span>
                  {f.attachments.length > 0 && (
                    <span className="muted3 row" style={{ fontSize: 12, fontWeight: 600, gap: 3 }}>
                      <i className="ti ti-photo" style={{ fontSize: 13 }} />
                      {f.attachments.length}
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>

          {!loading && items.length === 0 && (
            <Empty icon="ti-message-report" title={t('feedback.empty')} />
          )}
          {loading && items.length === 0 && (
            <div className="muted" style={{ textAlign: 'center', padding: 24, fontWeight: 600 }}>
              {t('common.loading')}
            </div>
          )}
          {items.length < total && (
            <button
              className="btn btn-soft btn-block"
              style={{ marginTop: 14 }}
              disabled={loading}
              onClick={() => void load(items.length)}
            >
              {t('feedback.load_more')}
            </button>
          )}
        </div>
      )}

      <PhotoModal attachmentId={viewing} onClose={() => setViewing(null)} />
    </div>
  )
}

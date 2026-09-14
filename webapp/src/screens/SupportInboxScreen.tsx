import { useCallback, useEffect, useState } from 'react'
import { Empty, OverlayHeader } from '../components/common'
import { useToast } from '../components/Toast'
import { api } from '../lib/api'
import { relativeTime } from '../lib/date'
import { haptic, onBackButton } from '../lib/telegram'
import { useT } from '../i18n'
import type { SupportThread } from '../lib/types'
import { SupportThreadScreen } from './SupportThreadScreen'

const threadName = (th: SupportThread) =>
  [th.user.firstName, th.user.lastName].filter(Boolean).join(' ') || th.user.phone

/** Admin-only support inbox: every user who has written in, most recent first,
 *  with an unread count. Tapping one opens the conversation. */
export function SupportInboxScreen({ onClose }: { onClose: () => void }) {
  const { t, lang } = useT()
  const toast = useToast()
  const [items, setItems] = useState<SupportThread[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<SupportThread | null>(null)

  // onBackButton *adds* a listener, so two mounted screens would both fire on
  // one tap. While a thread is open it owns the back button (it has its own
  // photo → close chain); the inbox only registers when nothing is above it.
  useEffect(() => {
    if (selected) return
    return onBackButton(onClose)
  }, [selected, onClose])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.adminSupportThreads()
      setItems(res.items)
    } catch (e) {
      toast(e instanceof Error ? e.message : t('common.something_wrong'), 'ti-alert-circle')
    } finally {
      setLoading(false)
    }
  }, [t, toast])

  useEffect(() => {
    void load()
  }, [load])

  // Coming back from a thread, the unread counts have changed.
  useEffect(() => {
    if (!selected) void load()
  }, [selected, load])

  return (
    <div className="overlay-screen">
      <OverlayHeader
        title={t('admin.support_title')}
        onClose={onClose}
        action={
          <button
            className="icon-btn"
            onClick={() => {
              haptic('light')
              void load()
            }}
            aria-label={t('admin.refresh')}
          >
            <i className={'ti ti-refresh' + (loading ? ' spin' : '')} />
          </button>
        }
      />

      <div className="tg-scroll" style={{ flex: 1, padding: '0 14px 20px' }}>
        {loading && items.length === 0 ? (
          <div className="col" style={{ gap: 8 }}>
            <div className="skel" style={{ height: 62, borderRadius: 21 }} />
            <div className="skel" style={{ height: 62, borderRadius: 21 }} />
          </div>
        ) : items.length === 0 ? (
          <Empty icon="ti-messages-off" title={t('admin.support_empty')} />
        ) : (
          <div className="col" style={{ gap: 8 }}>
            {items.map((th) => (
              <button
                key={th.user.id}
                className="card row"
                style={{
                  gap: 10,
                  textAlign: 'left',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  color: 'inherit',
                  width: '100%',
                }}
                onClick={() => {
                  haptic('light')
                  setSelected(th)
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
                    {threadName(th)}
                  </span>
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
                    {th.lastMessage.direction === 'out' ? `${t('admin.support_you')}: ` : ''}
                    {th.lastMessage.text || t('admin.support_photo')}
                  </span>
                </div>
                <div className="col" style={{ alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
                  <span className="muted3" style={{ fontSize: 12, fontWeight: 600 }}>
                    {relativeTime(t, lang, th.lastMessage.createdAt)}
                  </span>
                  {th.unread > 0 && <span className="pill pill-neg">{th.unread}</span>}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {selected && (
        <SupportThreadScreen
          userId={selected.user.id}
          title={threadName(selected)}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  )
}

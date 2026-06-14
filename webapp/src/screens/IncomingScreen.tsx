import { useState } from 'react'
import { Money } from '../components/Money'
import { SecTitle, Empty, BreakdownLines } from '../components/common'
import { useToast } from '../components/Toast'
import { api } from '../lib/api'
import { haptic } from '../lib/telegram'
import { prettyDate } from '../lib/date'
import { statusLabel, pillClass } from '../lib/status'
import { useT } from '../i18n'
import type { IncomingBill } from '../lib/types'

export function IncomingScreen({
  incoming,
  refresh,
}: {
  incoming: IncomingBill[]
  refresh: () => Promise<void>
}) {
  const { t, lang } = useT()
  const toast = useToast()
  const [busy, setBusy] = useState<string | null>(null)

  // Be resilient to unexpected payloads: drop malformed rows and coerce amounts
  // to numbers so one bad record can't throw and blank the screen.
  const items = (Array.isArray(incoming) ? incoming : []).filter(
    (x): x is IncomingBill => !!x && !!x.bill && !!x.participant
  )

  const owe = items
    .filter((x) => x.participant.status !== 'confirmed')
    .reduce((s, x) => s + (Number(x.participant.amount) || 0), 0)

  const markPaid = async (x: IncomingBill) => {
    setBusy(x.participant.id)
    try {
      await api.markPaid(x.participant.id)
      await refresh()
      haptic('success')
      toast(t('incoming.marked_paid'), 'ti-check')
    } catch (e) {
      toast(e instanceof Error ? e.message : t('common.something_wrong'), 'ti-alert-circle')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="tg-scroll" style={{ padding: '4px 16px 24px' }}>
      <div
        className="card pop"
        style={{ marginBottom: 16, background: 'var(--neg-soft)', border: 'none', padding: 18 }}
      >
        <span
          style={{
            fontSize: 12,
            fontWeight: 700,
            color: 'var(--neg-text)',
            textTransform: 'uppercase',
            letterSpacing: '.3px',
          }}
        >
          {t('incoming.you_owe_total')}
        </span>
        <Money
          amount={owe}
          style={{
            display: 'block',
            fontSize: 30,
            fontWeight: 800,
            color: 'var(--neg-text)',
            marginTop: 3,
            letterSpacing: '-.5px',
          }}
        />
      </div>

      <SecTitle>{t('incoming.bills_sent', { n: items.length })}</SecTitle>
      {items.length === 0 ? (
        <Empty
          icon="ti-inbox"
          title={t('incoming.nothing')}
          sub={t('incoming.nothing_sub')}
        />
      ) : (
        <div className="col" style={{ gap: 10 }}>
          {items.map((x) => (
            <div key={x.participant.id} className="card pop" style={{ padding: 'calc(14px * var(--dens))' }}>
              <div className="row" style={{ gap: 12 }}>
                <div
                  style={{
                    width: 42,
                    height: 42,
                    borderRadius: 'var(--r)',
                    background: 'var(--surface-2)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <i className="ti ti-receipt-2" style={{ fontSize: 22, color: 'var(--accent)' }} />
                </div>
                <div className="col" style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontWeight: 700, fontSize: 14.5 }}>{x.bill.title}</span>
                  <span className="muted" style={{ fontSize: 12.5, fontWeight: 600 }}>
                    {t('incoming.from', { name: x.bill.creatorName || t('common.friend') })} ·{' '}
                    {prettyDate(t, lang, x.bill.createdAt)}
                  </span>
                </div>
                <Money amount={Number(x.participant.amount) || 0} style={{ fontWeight: 800, fontSize: 16 }} />
              </div>
              <BreakdownLines b={x.participant} style={{ marginTop: 11 }} />
              <div className="row" style={{ marginTop: 12, justifyContent: 'space-between' }}>
                <span className={'pill ' + pillClass(x.participant.status)}>
                  {statusLabel(t, x.participant.status)}
                </span>
                {x.participant.status === 'pending' || x.participant.status === 'disputed' ? (
                  <button
                    className="btn btn-sm btn-primary"
                    disabled={busy === x.participant.id}
                    onClick={() => markPaid(x)}
                  >
                    <i className="ti ti-check" /> {t('incoming.mark_paid')}
                  </button>
                ) : x.participant.status === 'marked_paid' ? (
                  <span className="muted" style={{ fontSize: 12.5, fontWeight: 600 }}>
                    {t('incoming.awaiting')}
                  </span>
                ) : (
                  <span className="pill pill-pos">
                    <i className="ti ti-check" style={{ fontSize: 13 }} /> {t('incoming.paid')}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

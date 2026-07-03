import { useState } from 'react'
import { Avatar } from '../components/Avatar'
import { Money } from '../components/Money'
import { SecTitle, Empty } from '../components/common'
import { useToast } from '../components/Toast'
import { api, ApiError } from '../lib/api'
import { haptic } from '../lib/telegram'
import { prettyDate } from '../lib/date'
import { statusLabel, pillClass } from '../lib/status'
import { isSelf } from '../lib/billCalc'
import { useT } from '../i18n'
import type { BillDetail, BillParticipant, BillsResponse, Me } from '../lib/types'

/**
 * Everything that needs the user's attention, derived from the standard bills
 * fetch: payments awaiting their confirmation (as creator, confirmable inline)
 * and bills they still owe or had disputed (as payer). Rows open the bill.
 */
export function InboxScreen({
  bills,
  me,
  refresh,
  openBill,
}: {
  bills: BillsResponse
  me: Me
  refresh: () => Promise<void>
  openBill: (id: string) => void
}) {
  const { t, lang } = useT()
  const toast = useToast()
  const [busy, setBusy] = useState<string | null>(null)

  const toConfirm = bills.created
    .filter((b) => !b.archivedAt)
    .flatMap((bill) =>
      bill.participants
        .filter((p) => !isSelf(p, me) && p.status === 'marked_paid')
        .map((p) => ({ bill, p }))
    )
    // Oldest first — the payment that has waited longest is on top.
    .sort((a, b) => +new Date(a.p.markedPaidAt ?? 0) - +new Date(b.p.markedPaidAt ?? 0))

  const toPay = bills.incoming.filter(
    (x) => x.participant.status === 'pending' || x.participant.status === 'disputed'
  )

  const run = async (key: string, fn: () => Promise<unknown>, okMsg: string, icon: string) => {
    setBusy(key)
    try {
      await fn()
      await refresh()
      haptic('success')
      toast(okMsg, icon)
    } catch (e) {
      toast(e instanceof Error ? e.message : t('common.something_wrong'), 'ti-alert-circle')
    } finally {
      setBusy(null)
    }
  }

  const onConfirm = (bill: BillDetail, p: BillParticipant) =>
    run(p.id, () => api.confirm(bill.id, p.id), t('settle.confirmed_payment', { name: p.displayName }), 'ti-check')

  const onDispute = (bill: BillDetail, p: BillParticipant) => {
    const reason = window.prompt(t('settle.dispute_prompt', { name: p.displayName }))?.trim()
    if (!reason) return
    run(
      p.id,
      () => api.dispute(bill.id, p.id, reason),
      t('settle.disputed_payment', { name: p.displayName }),
      'ti-alert-triangle'
    )
  }

  if (toConfirm.length === 0 && toPay.length === 0) {
    return (
      <div className="tg-scroll" style={{ padding: '4px 16px 24px' }}>
        <Empty icon="ti-inbox" title={t('inbox.empty')} sub={t('inbox.empty_sub')} />
      </div>
    )
  }

  return (
    <div className="tg-scroll" style={{ padding: '4px 16px 24px' }}>
      {toConfirm.length > 0 && (
        <>
          <SecTitle>{t('inbox.confirm_section')}</SecTitle>
          <div className="col" style={{ gap: 10, marginBottom: 18 }}>
            {toConfirm.map(({ bill, p }) => (
              <div key={p.id} className="card pop" style={{ padding: 'calc(13px * var(--dens))' }}>
                <button
                  className="row"
                  onClick={() => openBill(bill.id)}
                  style={{
                    gap: 11,
                    width: '100%',
                    textAlign: 'left',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    padding: 0,
                  }}
                >
                  <Avatar id={p.contactId} name={p.displayName} size={38} />
                  <div className="col" style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontWeight: 700, fontSize: 14.5 }}>{p.displayName}</span>
                    <span className="muted" style={{ fontSize: 12.5, fontWeight: 600 }}>
                      {bill.title}
                      {p.markedPaidAt && (
                        <> · {t('inbox.marked_when', { when: prettyDate(t, lang, p.markedPaidAt) })}</>
                      )}
                    </span>
                  </div>
                  <Money amount={p.amount} style={{ fontSize: 16, fontWeight: 800 }} />
                </button>
                <div className="row" style={{ marginTop: 12, justifyContent: 'flex-end', gap: 7 }}>
                  <button className="btn btn-sm" disabled={busy === p.id} onClick={() => onDispute(bill, p)}>
                    <i className="ti ti-x" /> {t('settle.dispute')}
                  </button>
                  <button
                    className="btn btn-sm btn-primary"
                    disabled={busy === p.id}
                    onClick={() => onConfirm(bill, p)}
                  >
                    <i className="ti ti-check" /> {t('settle.confirm')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {toPay.length > 0 && (
        <>
          <SecTitle>{t('inbox.owe_section')}</SecTitle>
          <div className="col" style={{ gap: 10 }}>
            {toPay.map((x) => (
              <button
                key={x.participant.id}
                className="card pop row"
                onClick={() => openBill(x.bill.id)}
                style={{
                  gap: 12,
                  width: '100%',
                  textAlign: 'left',
                  cursor: 'pointer',
                  padding: 'calc(13px * var(--dens))',
                  alignItems: 'center',
                }}
              >
                <div
                  style={{
                    width: 42,
                    height: 42,
                    borderRadius: 'var(--r)',
                    background: 'var(--neg-soft)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <i className="ti ti-wallet" style={{ fontSize: 21, color: 'var(--neg-text)' }} />
                </div>
                <div className="col" style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontWeight: 700, fontSize: 14.5 }}>{x.bill.title}</span>
                  <span className="muted" style={{ fontSize: 12.5, fontWeight: 600 }}>
                    {t('incoming.from', { name: x.bill.creatorName || t('common.friend') })} ·{' '}
                    {prettyDate(t, lang, x.bill.createdAt)}
                  </span>
                </div>
                <div className="col" style={{ alignItems: 'flex-end', gap: 5, flexShrink: 0 }}>
                  <Money amount={x.participant.amount} style={{ fontWeight: 800, fontSize: 16 }} />
                  {x.participant.status === 'disputed' && (
                    <span className={'pill ' + pillClass(x.participant.status)} style={{ fontSize: 11 }}>
                      {statusLabel(t, x.participant.status)}
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

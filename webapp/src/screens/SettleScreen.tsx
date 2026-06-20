import { useState } from 'react'
import { Avatar } from '../components/Avatar'
import { Money } from '../components/Money'
import { SecTitle, Empty, BreakdownLines } from '../components/common'
import { useToast } from '../components/Toast'
import { money } from '../lib/currency'
import { api, ApiError } from '../lib/api'
import { haptic } from '../lib/telegram'
import { statusLabel, pillClass } from '../lib/status'
import { isSelf, createdOutstanding } from '../lib/billCalc'
import { useT } from '../i18n'
import type { BillDetail, BillParticipant, Me } from '../lib/types'

export function SettleScreen({
  bill,
  me,
  refresh,
  goSplit,
}: {
  bill: BillDetail | null
  me: Me
  refresh: () => Promise<void>
  goSplit: () => void
}) {
  const { t } = useT()
  const toast = useToast()
  const [busy, setBusy] = useState<string | null>(null)

  if (!bill) {
    return (
      <div className="tg-scroll" style={{ padding: '4px 16px 24px' }}>
        <Empty
          icon="ti-arrows-exchange"
          title={t('settle.no_bill_selected')}
          sub={t('settle.no_bill_sub')}
        />
        <button className="btn btn-block btn-soft btn-lg" onClick={goSplit}>
          <i className="ti ti-plus" /> {t('settle.new_bill')}
        </button>
      </div>
    )
  }

  const others = bill.participants.filter((p) => !isSelf(p, me))
  const outstanding = createdOutstanding(bill, me)
  const allSettled = others.length > 0 && others.every((p) => p.status === 'confirmed')

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

  const onRemind = (p: BillParticipant) =>
    run(
      p.id,
      async () => {
        const r = await api.remind(bill.id, p.id)
        if (!r.ok) throw new ApiError(t('settle.reminded_recently'), 429)
      },
      t('settle.reminder_sent', { name: p.displayName }),
      'ti-bell'
    )

  const onConfirm = (p: BillParticipant) =>
    run(
      p.id,
      () => api.confirm(bill.id, p.id),
      t('settle.confirmed_payment', { name: p.displayName }),
      'ti-check'
    )

  const onDispute = (p: BillParticipant) => {
    const reason = window.prompt(t('settle.dispute_prompt', { name: p.displayName }))?.trim()
    if (!reason) return
    run(
      p.id,
      () => api.dispute(bill.id, p.id, reason),
      t('settle.disputed_payment', { name: p.displayName }),
      'ti-alert-triangle'
    )
  }

  return (
    <div className="tg-scroll" style={{ padding: '4px 16px 24px' }}>
      {/* hero */}
      <div
        className="card pop"
        style={{
          marginBottom: 16,
          textAlign: 'center',
          padding: '22px 18px',
          background: allSettled ? 'var(--pos-soft)' : 'var(--surface)',
          border: 'none',
        }}
      >
        <div
          style={{
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: '.3px',
            textTransform: 'uppercase',
            color: allSettled ? 'var(--pos-text)' : 'var(--text-2)',
          }}
        >
          {allSettled ? t('settle.all_settled') : t('settle.youre_owed')}
        </div>
        <Money
          amount={outstanding}
          style={{
            fontSize: 40,
            fontWeight: 800,
            letterSpacing: '-1px',
            color: allSettled ? 'var(--pos-text)' : 'var(--text)',
            display: 'block',
            marginTop: 4,
          }}
        />
        <div className="muted" style={{ fontSize: 13, fontWeight: 600, marginTop: 4 }}>
          {t('settle.bill_total_line', { title: bill.title, amount: money(bill.total) })}
        </div>
      </div>

      {/* who owes you */}
      <SecTitle>{t('settle.who_owes_you')}</SecTitle>
      {others.length === 0 ? (
        <div
          className="card"
          style={{
            textAlign: 'center',
            color: 'var(--text-3)',
            fontWeight: 600,
            fontSize: 14,
            padding: 22,
            marginBottom: 18,
          }}
        >
          {t('settle.just_you')}
        </div>
      ) : (
        <div className="col" style={{ gap: 10, marginBottom: 18 }}>
          {others.map((p) => (
            <div key={p.id} className="card pop" style={{ padding: 'calc(13px * var(--dens))' }}>
              <div className="row" style={{ gap: 11 }}>
                <Avatar id={p.contactId} name={p.displayName} size={38} />
                <div className="col" style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontWeight: 700, fontSize: 14.5 }}>{p.displayName}</span>
                  <span className="muted" style={{ fontSize: 12.5, fontWeight: 600 }}>
                    {statusLabel(t, p.status)}
                  </span>
                </div>
                <Money amount={p.amount} style={{ fontSize: 16, fontWeight: 800 }} />
              </div>
              {p.status === 'confirmed' ? (
                <div className="row" style={{ marginTop: 12, justifyContent: 'flex-end' }}>
                  <span className="pill pill-pos">
                    <i className="ti ti-check" style={{ fontSize: 13 }} /> {t('settle.settled')}
                  </span>
                </div>
              ) : (
                <div className="row" style={{ gap: 7, marginTop: 12, justifyContent: 'flex-end' }}>
                  {p.status === 'marked_paid' ? (
                    <button className="btn btn-sm" disabled={busy === p.id} onClick={() => onDispute(p)}>
                      <i className="ti ti-x" /> {t('settle.dispute')}
                    </button>
                  ) : (
                    <button className="btn btn-sm" disabled={busy === p.id} onClick={() => onRemind(p)}>
                      <i className="ti ti-bell" /> {t('settle.remind')}
                    </button>
                  )}
                  <button
                    className="btn btn-sm btn-primary"
                    disabled={busy === p.id}
                    onClick={() => onConfirm(p)}
                  >
                    <i className="ti ti-check" /> {t('settle.confirm')}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* per person — full itemization (creator's view) */}
      <SecTitle>{t('settle.per_person')}</SecTitle>
      <div className="col" style={{ gap: 10 }}>
        {bill.participants.map((p) => {
          const self = isSelf(p, me)
          return (
            <div key={p.id} className="card pop" style={{ padding: 'calc(13px * var(--dens))' }}>
              <div className="row" style={{ gap: 11 }}>
                <Avatar id={p.contactId} name={self ? t('common.you') : p.displayName} size={38} />
                <div className="col" style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontWeight: 700, fontSize: 14.5 }}>
                    {self ? t('common.you') : p.displayName}
                  </span>
                  <span className="muted tnum" style={{ fontSize: 12.5, fontWeight: 600 }}>
                    {self
                      ? t('settle.spent_label', { amount: money(p.amount) })
                      : t('settle.owes_label', { amount: money(p.amount) })}
                  </span>
                </div>
                <div className="row" style={{ gap: 6, flexShrink: 0 }}>
                  {bill.tipPaidByContactId === p.contactId && (
                    <span className="pill pill-pos">
                      <i className="ti ti-coin" style={{ fontSize: 12 }} /> {t('settle.paid_tip_pill')}
                    </span>
                  )}
                  {self ? (
                    <span className="pill pill-mut">{t('settle.spent_pill')}</span>
                  ) : (
                    <span className={'pill ' + pillClass(p.status)}>{statusLabel(t, p.status)}</span>
                  )}
                </div>
              </div>
              <BreakdownLines b={p} style={{ marginTop: 11, paddingLeft: 49 }} />
            </div>
          )
        })}
      </div>
    </div>
  )
}

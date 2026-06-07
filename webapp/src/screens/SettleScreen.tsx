import { useState } from 'react'
import { Avatar } from '../components/Avatar'
import { Money } from '../components/Money'
import { SecTitle, Empty } from '../components/common'
import { useToast } from '../components/Toast'
import { money } from '../lib/currency'
import { api, ApiError } from '../lib/api'
import { haptic } from '../lib/telegram'
import { statusLabel, pillClass } from '../lib/status'
import { isSelf, createdOutstanding } from '../lib/billCalc'
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
  const toast = useToast()
  const [busy, setBusy] = useState<string | null>(null)

  if (!bill) {
    return (
      <div className="tg-scroll" style={{ padding: '4px 16px 24px' }}>
        <Empty
          icon="ti-arrows-exchange"
          title="No bill selected"
          sub="Create a bill in Split, or pick one from Activity to settle it."
        />
        <button className="btn btn-block btn-soft btn-lg" onClick={goSplit}>
          <i className="ti ti-plus" /> New bill
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
      toast(e instanceof Error ? e.message : 'Something went wrong', 'ti-alert-circle')
    } finally {
      setBusy(null)
    }
  }

  const onRemind = (p: BillParticipant) =>
    run(
      p.id,
      async () => {
        const r = await api.remind(bill.id, p.id)
        if (!r.ok) throw new ApiError('Reminded recently — try again later', 429)
      },
      `Reminder sent to ${p.displayName}`,
      'ti-bell'
    )

  const onConfirm = (p: BillParticipant) =>
    run(p.id, () => api.confirm(bill.id, p.id), `Confirmed ${p.displayName}'s payment`, 'ti-check')

  const onDispute = (p: BillParticipant) => {
    const reason = window.prompt(`Dispute ${p.displayName}'s payment — reason?`)?.trim()
    if (!reason) return
    run(p.id, () => api.dispute(bill.id, p.id, reason), `Disputed ${p.displayName}'s payment`, 'ti-alert-triangle')
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
          {allSettled ? 'All settled' : "You're owed"}
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
          {bill.title} · total {money(bill.total)}
        </div>
      </div>

      {/* who owes you */}
      <SecTitle>Who owes you</SecTitle>
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
          Just you on this bill.
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
                    {statusLabel(p.status)}
                  </span>
                </div>
                <Money amount={p.amount} style={{ fontSize: 16, fontWeight: 800 }} />
              </div>
              {p.status === 'confirmed' ? (
                <div className="row" style={{ marginTop: 12, justifyContent: 'flex-end' }}>
                  <span className="pill pill-pos">
                    <i className="ti ti-check" style={{ fontSize: 13 }} /> Settled
                  </span>
                </div>
              ) : (
                <div className="row" style={{ gap: 7, marginTop: 12, justifyContent: 'flex-end' }}>
                  {p.status === 'marked_paid' ? (
                    <button className="btn btn-sm" disabled={busy === p.id} onClick={() => onDispute(p)}>
                      <i className="ti ti-x" /> Dispute
                    </button>
                  ) : (
                    <button className="btn btn-sm" disabled={busy === p.id} onClick={() => onRemind(p)}>
                      <i className="ti ti-bell" /> Remind
                    </button>
                  )}
                  <button
                    className="btn btn-sm btn-primary"
                    disabled={busy === p.id}
                    onClick={() => onConfirm(p)}
                  >
                    <i className="ti ti-check" /> Confirm
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* per person */}
      <SecTitle>Per person</SecTitle>
      <div className="card" style={{ padding: '6px 4px' }}>
        {bill.participants.map((p, i) => (
          <div
            key={p.id}
            className="row"
            style={{
              gap: 12,
              padding: '11px 12px',
              borderBottom: i < bill.participants.length - 1 ? '1px solid var(--border)' : 'none',
            }}
          >
            <Avatar id={p.contactId} name={p.displayName} size={40} />
            <div className="col" style={{ flex: 1, minWidth: 0 }}>
              <span style={{ fontWeight: 700, fontSize: 14.5 }}>
                {isSelf(p, me) ? 'You' : p.displayName}
              </span>
              <span className="muted tnum" style={{ fontSize: 12.5, fontWeight: 600 }}>
                share {money(p.amount)}
              </span>
            </div>
            <span className={'pill ' + pillClass(p.status)}>{statusLabel(p.status)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

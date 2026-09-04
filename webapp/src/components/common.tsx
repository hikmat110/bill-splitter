import type { ReactNode } from 'react'
import { money } from '../lib/currency'
import { useT } from '../i18n'
import type { Breakdown } from '../lib/types'

/** Indented item-by-item cost lines for one participant (name … amount). */
export function BreakdownLines({ b, style }: { b: Breakdown; style?: React.CSSProperties }) {
  const { t } = useT()
  if (b.items.length === 0 && b.service <= 0 && b.tip <= 0 && b.tipPaid <= 0) return null
  return (
    <div className="col" style={{ gap: 5, ...style }}>
      {b.items.map((it, idx) => (
        <Line key={idx} label={it.units ? `${it.name} ×${it.units}` : it.name} amount={it.share} />
      ))}
      {b.service > 0 && <Line label={t('breakdown.service')} amount={b.service} />}
      {b.tip > 0 && <Line label={t('breakdown.tip')} amount={b.tip} />}
      {b.tipPaid > 0 && <Line label={t('breakdown.tip_paid')} amount={-b.tipPaid} credit />}
    </div>
  )
}

function Line({ label, amount, credit }: { label: string; amount: number; credit?: boolean }) {
  return (
    <div className="row" style={{ justifyContent: 'space-between', gap: 12 }}>
      <span
        className="muted"
        style={{
          fontSize: 12.5,
          fontWeight: 600,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </span>
      <span
        className={credit ? 'tnum' : 'muted tnum'}
        style={{
          fontSize: 12.5,
          fontWeight: 600,
          flexShrink: 0,
          ...(credit ? { color: 'var(--pos-text)' } : {}),
        }}
      >
        {money(amount, { signed: credit })}
      </span>
    </div>
  )
}

export function SecTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="between" style={{ padding: '0 4px 9px' }}>
      <div className="sec-title" style={{ padding: 0 }}>
        {children}
      </div>
      {action}
    </div>
  )
}

export function Empty({ icon, title, sub }: { icon: string; title: string; sub?: string }) {
  return (
    <div
      className="col"
      style={{ alignItems: 'center', textAlign: 'center', padding: '46px 24px', gap: 6 }}
    >
      <div
        style={{
          width: 64,
          height: 64,
          borderRadius: 20,
          background: 'var(--surface-2)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 6,
        }}
      >
        <i className={'ti ' + icon} style={{ fontSize: 30, color: 'var(--text-3)' }} />
      </div>
      <div style={{ fontWeight: 700, fontSize: 16 }}>{title}</div>
      {sub && (
        <div className="muted" style={{ fontSize: 13.5, maxWidth: 220, lineHeight: 1.5 }}>
          {sub}
        </div>
      )}
    </div>
  )
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string }[]
}) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button key={o.value} className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Field({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <label className="field">
      {label && <span className="field-label">{label}</span>}
      {children}
    </label>
  )
}

/** Top bar for a full-screen overlay (bill detail, admin inbox, user detail):
 *  back chevron + title + optional subtitle. Telegram's native back button is
 *  wired separately by the screen via onBackButton. */
export function OverlayHeader({
  title,
  sub,
  onClose,
  action,
}: {
  title: string
  sub?: string
  onClose: () => void
  action?: ReactNode
}) {
  return (
    <div className="topbar" style={{ gap: 8 }}>
      <button className="icon-btn" onClick={onClose} aria-label="Back">
        <i className="ti ti-chevron-left" />
      </button>
      <div className="col" style={{ flex: 1, minWidth: 0 }}>
        <span
          style={{
            fontWeight: 800,
            fontSize: 16.5,
            letterSpacing: '-.3px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {title}
        </span>
        {sub && (
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
            {sub}
          </span>
        )}
      </div>
      {action}
    </div>
  )
}

/** Stat tile: label + value (+ optional sub-line). Values keep proportional
 *  figures — tabular digits only belong in columns. */
export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: string }) {
  return (
    <div className="stat">
      <div className="stat-lbl">{label}</div>
      <div className="stat-val">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  )
}

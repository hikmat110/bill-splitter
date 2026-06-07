import type { ReactNode } from 'react'

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

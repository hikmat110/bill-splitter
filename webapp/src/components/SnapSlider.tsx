import { haptic } from '../lib/telegram'

/**
 * Compact single-line slider that snaps between a fixed set of options.
 * Drives a native range input over the option *index* (even spacing regardless
 * of the underlying values) and maps index ⇄ value.
 */
export function SnapSlider({
  options,
  value,
  onChange,
}: {
  options: { value: number; label: string }[]
  value: number
  onChange: (v: number) => void
}) {
  const found = options.findIndex((o) => o.value === value)
  const idx = found < 0 ? 0 : found
  const max = options.length - 1
  const fill = max > 0 ? (idx / max) * 100 : 0

  return (
    <div className="col" style={{ gap: 9 }}>
      <div className="snap-ticks">
        {options.map((o, i) => (
          <span key={o.value} className={i === idx ? 'on' : ''}>
            {o.label}
          </span>
        ))}
      </div>
      <input
        type="range"
        className="snap-slider"
        min={0}
        max={max}
        step={1}
        value={idx}
        onChange={(e) => {
          const next = Number(e.target.value)
          if (next !== idx) haptic('light')
          onChange(options[next].value)
        }}
        style={{ ['--fill' as string]: fill + '%' }}
      />
    </div>
  )
}

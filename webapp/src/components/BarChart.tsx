import { useState } from 'react'
import { useT } from '../i18n'
import type { WeekBucket } from '../lib/types'

const DATE_LOCALE: Record<string, string> = { ru: 'ru-RU', uz: 'uz-UZ', en: 'en-US' }

/** Single-series weekly column chart. HTML bars rather than SVG so the rounded
 *  data-ends never stretch; one accent hue, no legend (the title names the
 *  series). Tap a bar to read it; the newest, partial week is dimmed. */
export function BarChart({ data, title }: { data: WeekBucket[]; title: string }) {
  const { t, lang } = useT()
  const [picked, setPicked] = useState<number | null>(null)
  const max = data.reduce((m, d) => Math.max(m, d.count), 0)
  const sel = picked !== null && picked < data.length ? picked : data.length - 1
  const cur = data[sel]
  const weekLabel = (iso: string) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString(DATE_LOCALE[lang] ?? 'en-US', {
      month: 'short',
      day: 'numeric',
    })

  return (
    <div className="card" style={{ padding: 'calc(13px * var(--dens))' }}>
      <div className="between" style={{ gap: 10, marginBottom: 10 }}>
        <span style={{ fontWeight: 700, fontSize: 13.5, flexShrink: 0 }}>{title}</span>
        {cur && max > 0 && (
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
            {t('admin.chart_week', { date: weekLabel(cur.week) })} ·{' '}
            <b style={{ color: 'var(--text)' }}>{cur.count}</b>
          </span>
        )}
      </div>

      <div className="bars">
        {data.map((d, i) => (
          <span key={d.week}>
            <button
              type="button"
              className={[
                d.count === 0 ? 'zero' : '',
                i === data.length - 1 ? 'last' : '',
                max > 0 && i === sel ? 'on' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              style={{
                height:
                  d.count === 0 || max === 0
                    ? 2
                    : `${Math.max(6, Math.round((d.count / max) * 100))}%`,
              }}
              onClick={() => setPicked(i)}
              aria-label={`${weekLabel(d.week)}: ${d.count}`}
            />
          </span>
        ))}
      </div>

      {max === 0 ? (
        <div className="muted3" style={{ fontSize: 12, fontWeight: 600, marginTop: 6 }}>
          {t('admin.chart_empty')}
        </div>
      ) : (
        data.length > 1 && (
          <div className="bars-axis">
            <span>{weekLabel(data[0]!.week)}</span>
            <span>{weekLabel(data[data.length - 1]!.week)}</span>
          </div>
        )
      )}
    </div>
  )
}

import { useEffect, useState } from 'react'
import { haptic, onBackButton } from '../lib/telegram'
import { useT } from '../i18n'

const SLIDES = [
  { icon: 'ti-sparkles', title: 'tour.s1_title', sub: 'tour.s1_sub' },
  { icon: 'ti-users', title: 'tour.s2_title', sub: 'tour.s2_sub' },
  { icon: 'ti-credit-card', title: 'tour.s3_title', sub: 'tour.s3_sub' },
] as const

/** First-open welcome tour: three slides over everything, dismissible at any
 *  point via Skip or Telegram's native back button. */
export function WelcomeTour({ onClose }: { onClose: () => void }) {
  const { t } = useT()
  const [step, setStep] = useState(0)
  const slide = SLIDES[step] ?? SLIDES[0]
  const last = step === SLIDES.length - 1

  useEffect(() => onBackButton(onClose), [onClose])

  const next = () => {
    if (last) {
      onClose()
      return
    }
    haptic('light')
    setStep(step + 1)
  }

  return (
    <div className="overlay-screen">
      <div className="row" style={{ justifyContent: 'flex-end', padding: '14px 16px 0' }}>
        <button className="btn btn-sm" onClick={onClose}>
          {t('tour.skip')}
        </button>
      </div>

      <div
        className="col"
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          padding: '0 32px',
          gap: 8,
        }}
      >
        <div
          style={{
            width: 84,
            height: 84,
            borderRadius: 26,
            background: 'var(--accent-soft)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 10,
          }}
        >
          <i className={'ti ' + slide.icon} style={{ fontSize: 40, color: 'var(--accent-text)' }} />
        </div>
        <div style={{ fontWeight: 800, fontSize: 21, letterSpacing: '-0.3px' }}>{t(slide.title)}</div>
        <div className="muted" style={{ fontSize: 14.5, lineHeight: 1.55, maxWidth: 280 }}>
          {t(slide.sub)}
        </div>
      </div>

      <div
        className="col"
        style={{
          padding: '0 24px calc(26px + env(safe-area-inset-bottom, 0px))',
          gap: 16,
          alignItems: 'center',
        }}
      >
        <div className="row" style={{ gap: 6 }}>
          {SLIDES.map((_, i) => (
            <span
              key={i}
              style={{
                width: i === step ? 18 : 7,
                height: 7,
                borderRadius: 4,
                background: i === step ? 'var(--accent)' : 'var(--surface-2)',
                transition: 'all .25s',
              }}
            />
          ))}
        </div>
        <button className="btn btn-primary btn-block" onClick={next}>
          {last ? t('tour.start') : t('tour.next')}
        </button>
      </div>
    </div>
  )
}

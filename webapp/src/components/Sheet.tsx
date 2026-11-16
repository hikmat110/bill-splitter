import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'

export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
  maxHeight,
}: {
  open: boolean
  onClose: () => void
  title?: ReactNode
  children: ReactNode
  /** Pinned call-to-action. When set, the sheet stops scrolling as a whole: the
   *  handle/title become a fixed header, `children` scroll between them, and this
   *  stays put at the bottom edge so it survives a long list. */
  footer?: ReactNode
  maxHeight?: number | string
}) {
  const [mounted, setMounted] = useState(open)
  useEffect(() => {
    if (open) setMounted(true)
  }, [open])
  if (!mounted && !open) return null
  return (
    <div
      className={'scrim' + (open ? ' open' : '')}
      onClick={onClose}
      onTransitionEnd={() => {
        if (!open) setMounted(false)
      }}
    >
      <div
        className={'sheet' + (footer ? ' with-footer' : '')}
        style={maxHeight ? { maxHeight } : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-handle" />
        {title && <div className="sheet-title">{title}</div>}
        {footer ? (
          <>
            <div className="sheet-body">{children}</div>
            <div className="sheet-footer">{footer}</div>
          </>
        ) : (
          children
        )}
      </div>
    </div>
  )
}

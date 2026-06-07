import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'

export function Sheet({
  open,
  onClose,
  title,
  children,
  maxHeight,
}: {
  open: boolean
  onClose: () => void
  title?: ReactNode
  children: ReactNode
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
        className="sheet"
        style={maxHeight ? { maxHeight } : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-handle" />
        {title && <div className="sheet-title">{title}</div>}
        {children}
      </div>
    </div>
  )
}

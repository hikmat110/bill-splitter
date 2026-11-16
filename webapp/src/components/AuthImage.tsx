import { useEffect, useState } from 'react'
import { api } from '../lib/api'

/**
 * Renders a protected image from `GET /api/files/:id`. Since an <img> can't send
 * the `tma` Authorization header, we fetch the bytes into an object URL and
 * revoke it on unmount. Shows a lightweight placeholder while loading / on error.
 */
export function AuthImage({
  attachmentId,
  alt,
  onClick,
  style,
  className,
}: {
  attachmentId: string
  alt?: string
  onClick?: () => void
  style?: React.CSSProperties
  className?: string
}) {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let revoked: string | null = null
    let alive = true
    setFailed(false)
    setUrl(null)
    api
      .fileObjectUrl(attachmentId)
      .then((u) => {
        if (!alive) {
          URL.revokeObjectURL(u)
          return
        }
        revoked = u
        setUrl(u)
      })
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
      if (revoked) URL.revokeObjectURL(revoked)
    }
  }, [attachmentId])

  const base: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'var(--surface-2)',
    color: 'var(--text-3)',
    overflow: 'hidden',
    cursor: onClick ? 'pointer' : 'default',
    ...style,
  }

  if (failed) {
    return (
      <div className={className} style={base} onClick={onClick}>
        <i className="ti ti-photo-off" style={{ fontSize: 18 }} />
      </div>
    )
  }
  if (!url) {
    return (
      <div className={className} style={base} onClick={onClick}>
        <i className="ti ti-photo" style={{ fontSize: 18, opacity: 0.5 }} />
      </div>
    )
  }
  return (
    <img
      className={className}
      src={url}
      alt={alt ?? ''}
      onClick={onClick}
      style={{ objectFit: 'cover', ...base, ...style }}
    />
  )
}

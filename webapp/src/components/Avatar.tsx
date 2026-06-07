import type { CSSProperties } from 'react'
import { avatarColor, initials } from '../lib/avatar'

export function Avatar({
  id,
  name,
  size = 40,
  ring = false,
  style,
}: {
  id: string
  name: string
  size?: number
  ring?: boolean
  style?: CSSProperties
}) {
  const color = avatarColor(id)
  return (
    <div
      className="avatar"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.38,
        background: color,
        boxShadow: ring ? `0 0 0 2.5px var(--surface), 0 0 0 4px ${color}` : 'none',
        ...style,
      }}
    >
      {initials(name)}
    </div>
  )
}

export function AvatarStack({
  people,
  size = 28,
  max = 4,
}: {
  people: { id: string; name: string }[]
  size?: number
  max?: number
}) {
  const shown = people.slice(0, max)
  const extra = people.length - shown.length
  return (
    <div className="row" style={{ paddingLeft: size * 0.32 }}>
      {shown.map((p, i) => (
        <div key={p.id} style={{ marginLeft: -size * 0.32, zIndex: i }}>
          <Avatar id={p.id} name={p.name} size={size} ring />
        </div>
      ))}
      {extra > 0 && (
        <div
          className="avatar"
          style={{
            width: size,
            height: size,
            fontSize: size * 0.36,
            marginLeft: -size * 0.32,
            background: 'var(--surface-2)',
            color: 'var(--text-2)',
            boxShadow: '0 0 0 2.5px var(--surface)',
          }}
        >
          +{extra}
        </div>
      )}
    </div>
  )
}

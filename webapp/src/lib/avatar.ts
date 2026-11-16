// Avatar color + initials — keyed on contact id (warm friendly palette).

const PALETTE = [
  '#E8765A', // coral
  '#5B8DEF', // blue
  '#3FB489', // green
  '#C9709E', // rose
  '#E0A33E', // amber
  '#8B7BD8', // violet
  '#46B0C4', // teal
  '#D88A4F', // clay
]

export function hashStr(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i)
    h |= 0
  }
  return h
}

export function avatarColor(id: string): string {
  return PALETTE[Math.abs(hashStr(id)) % PALETTE.length]!
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  const base =
    parts.length > 1 ? (parts[0]![0] ?? '') + (parts[1]![0] ?? '') : name.slice(0, 2)
  return base.toUpperCase()
}

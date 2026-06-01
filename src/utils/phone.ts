export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  return `+${digits}`
}

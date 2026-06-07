/**
 * Normalize a Telegram username for storage/comparison: strip any leading `@`,
 * trim surrounding whitespace, and lowercase (Telegram usernames are
 * case-insensitive). Returns '' for input that is only `@`/whitespace.
 */
export function normalizeUsername(input: string): string {
  return input.trim().replace(/^@+/, '').trim().toLowerCase()
}

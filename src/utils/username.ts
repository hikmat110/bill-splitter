/**
 * Normalize a Telegram username for storage/comparison: strip any leading `@`,
 * trim surrounding whitespace, and lowercase (Telegram usernames are
 * case-insensitive). Returns '' for input that is only `@`/whitespace.
 */
export function normalizeUsername(input: string): string {
  return input.trim().replace(/^@+/, '').trim().toLowerCase()
}

/**
 * Parse a free-text list of Telegram usernames separated by commas, spaces, or
 * newlines into normalized handles. Drops empties and de-duplicates while
 * preserving first-seen order. e.g. "@A, b\nA" → ['a', 'b'].
 */
export function parseUsernameList(input: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const token of input.split(/[\s,]+/)) {
    const handle = normalizeUsername(token)
    if (handle && !seen.has(handle)) {
      seen.add(handle)
      out.push(handle)
    }
  }
  return out
}

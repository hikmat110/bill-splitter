/**
 * Postgres error classification. Pure and structural (no driver import) so it
 * is unit-testable with plain objects, same grain as utils/telegram-errors.
 */

/**
 * True for a unique-constraint violation (SQLSTATE 23505).
 *
 * Several flows rely on the database to arbitrate a race rather than checking
 * first and inserting second: contact name collisions, and the "one open split
 * per group" partial unique index. Both catch this and recover.
 */
export function isUniqueViolation(err: unknown): boolean {
  const code = (err as { code?: string })?.code
  if (code === '23505') return true
  return (
    err instanceof Error &&
    (err.message.includes('unique') || err.message.includes('duplicate'))
  )
}

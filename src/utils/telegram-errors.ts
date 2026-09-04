/**
 * Classify a failed Bot API send into a code the Mini App can localize. Pure
 * and structural (no grammy import) so it is unit-testable with plain objects;
 * grammY's GrammyError carries exactly these two fields.
 */

export type SendFailureCode = 'blocked' | 'chat_not_found' | 'rate_limited' | 'send_failed'

export function classifySendError(e: unknown): SendFailureCode {
  const rec = (typeof e === 'object' && e !== null ? e : {}) as {
    error_code?: unknown
    description?: unknown
  }
  const code = typeof rec.error_code === 'number' ? rec.error_code : null
  const desc = typeof rec.description === 'string' ? rec.description : ''
  // 403 covers "bot was blocked by the user", "user is deactivated", and
  // "bot can't initiate conversation" — all mean "this chat is unreachable".
  if (code === 403) return 'blocked'
  if (code === 400 && /chat not found/i.test(desc)) return 'chat_not_found'
  if (code === 429) return 'rate_limited'
  return 'send_failed'
}

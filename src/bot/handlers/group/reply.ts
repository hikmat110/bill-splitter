import type { MyContext } from '../../index'
import { t, type I18nKey } from '../../../i18n'

/**
 * The only way a group handler is allowed to talk back to someone.
 *
 * A callback answer is a toast visible solely to the person who pressed the
 * button, so it costs nothing in the chat. Every rejection, every "you're
 * already in", every authorization failure goes through here — which is what
 * keeps the bot structurally incapable of spamming a group it was added to.
 *
 * `url` opens a link on the presser's client; Telegram permits a
 * `t.me/<bot>?start=…` deep link here, which is how an unregistered joiner is
 * sent to the private chat without posting anything publicly.
 */
export async function toast(
  ctx: MyContext,
  key: I18nKey,
  opts?: { alert?: boolean; url?: string; vars?: Record<string, string> }
): Promise<void> {
  await ctx
    .answerCallbackQuery({
      text: t(ctx, key, opts?.vars),
      show_alert: opts?.alert ?? false,
      ...(opts?.url ? { url: opts.url } : {}),
    })
    .catch(() => undefined)
}

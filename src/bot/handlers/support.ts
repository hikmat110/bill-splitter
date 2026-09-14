import type { Bot } from 'grammy'
import type { MyContext } from '../index'
import { config } from '../../config'
import { t } from '../../i18n'
import { isAdmin } from '../../server/authz'
import {
  ADMIN_PING_WINDOW_MS,
  SUPPORT_ACK_WINDOW_MS,
  isNewBurst,
  isSupportCandidate,
} from '../../utils/support'
import { recordInbound, SupportLimitError } from '../../services/support.service'
import { notifyAdminsOfSupportMessage } from '../../services/notification.service'

/**
 * A message the bot could not route to any wizard is a message to support.
 * Stores it, acks the user once per burst, and pings the admins once per burst;
 * the admin tab's Support inbox is where the conversation actually happens.
 *
 * Returns false when nothing was stored, so a caller that already persisted an
 * attachment can clean it up.
 */
async function capture(
  ctx: MyContext,
  bot: Bot<MyContext>,
  input: { text: string; attachmentId?: string; attachmentMime?: string }
): Promise<boolean> {
  // An admin talking to the bot would otherwise open a thread against
  // themselves and fill their own inbox.
  if (isAdmin(ctx.user, config.ADMIN_TELEGRAM_IDS)) return false

  let stored
  try {
    stored = await recordInbound(ctx.user.id, {
      text: input.text,
      attachmentId: input.attachmentId ?? null,
      attachmentMime: input.attachmentMime ?? null,
      tgMessageId: ctx.message?.message_id ?? null,
    })
  } catch (err) {
    if (err instanceof SupportLimitError) {
      await ctx.reply(t(ctx, 'support.rate_limited'))
      return false
    }
    throw err
  }

  const now = stored.message.created_at
  if (isNewBurst(stored.lastInboundAt, now, SUPPORT_ACK_WINDOW_MS)) {
    await ctx.reply(t(ctx, 'support.received'))
  }

  if (isNewBurst(stored.lastInboundAt, now, ADMIN_PING_WINDOW_MS)) {
    await notifyAdminsOfSupportMessage(bot, {
      message: input.text,
      hasPhoto: Boolean(input.attachmentId),
      sender: {
        first_name: ctx.user.first_name,
        last_name: ctx.user.last_name,
        username: ctx.user.username,
        telegram_id: ctx.user.telegram_id,
      },
      attachment:
        input.attachmentId && input.attachmentMime
          ? { attachment_id: input.attachmentId, mime: input.attachmentMime }
          : null,
    })
  }

  return true
}

/** Text the dispatcher could not hand to a wizard. */
export async function supportTextHandler(ctx: MyContext, bot: Bot<MyContext>): Promise<void> {
  const text = ctx.message?.text ?? ''
  if (!isSupportCandidate(text)) return
  await capture(ctx, bot, { text: text.trim() })
}

/**
 * A photo no wizard was waiting for; its caption becomes the message body.
 * Returns false when the photo was not stored (an admin, or over the daily cap)
 * so the caller can drop the file it already wrote to disk.
 */
export async function supportPhotoHandler(
  ctx: MyContext,
  bot: Bot<MyContext>,
  attachment: { id: string; mime: string }
): Promise<boolean> {
  return capture(ctx, bot, {
    text: (ctx.message?.caption ?? '').trim(),
    attachmentId: attachment.id,
    attachmentMime: attachment.mime,
  })
}

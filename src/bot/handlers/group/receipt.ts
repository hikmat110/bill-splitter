import type { Bot } from 'grammy'
import type { MyContext } from '../../index'
import type { User } from '../../../db/schema'
import { t } from '../../../i18n'
import { isBoardReply } from '../../../utils/chat-scope'
import { saveImage, StorageError } from '../../../services/storage.service'
import { downloadTelegramFile } from '../../../services/telegram-file.service'
import { findOpenSplit, attachReceipt } from '../../../services/group-split.service'
import { refreshGroupBoard } from '../../../services/group-board.service'
import { splitAppUrl } from '../../keyboards'
import { InlineKeyboard } from 'grammy'

/**
 * Receipt upload in a group.
 *
 * With Telegram privacy mode on, a bot receives a reply to one of its own
 * messages even when that reply carries no command and no caption — so "reply
 * to my card with a photo of the receipt" is a guaranteed-delivery path, unlike
 * a photo captioned /scan, which Telegram does not promise to deliver.
 *
 * The gate below is deliberately four conditions wide. Anything that does not
 * satisfy all of them returns in silence: no reply, no support ticket, no log
 * noise. A group photo is somebody's lunch until proven otherwise.
 */
export async function groupPhotoHandler(ctx: MyContext, bot: Bot<MyContext>): Promise<void> {
  const user = ctx.user as User | undefined
  if (!user) return

  const split = await findOpenSplit(BigInt(ctx.chat!.id))
  if (!split) return
  // 1 + 2: a reply to this split's card specifically, not to some other bot
  // message (an old board, an error) that happens to be ours.
  if (!isBoardReply(ctx.message, ctx.me.id, Number(split.board_message_id))) return
  // 3: only the host attaches the receipt — the scan quota is billed to them.
  if (split.creator_id !== user.id) return
  // 4: pointless once the bill has been sent.
  if (split.status !== 'collecting' && split.status !== 'building') return

  const photo = ctx.message?.photo?.at(-1)
  if (!photo) return

  let stored
  try {
    const bytes = await downloadTelegramFile(ctx.api, photo.file_id)
    stored = await saveImage(bytes, 'image/jpeg')
  } catch (err) {
    if (err instanceof StorageError) {
      ctx.logger.warn({ code: err.code }, 'group receipt upload rejected')
    } else {
      ctx.logger.error({ err }, 'group receipt upload failed')
    }
    await ctx.reply(t(ctx, 'errors.upload_failed')).catch(() => undefined)
    return
  }

  await attachReceipt(split.id, stored.id, stored.mime)

  // Gemini is deliberately NOT called here: the Mini App runs the existing
  // POST /api/receipts/scan when the host opens the split, so an abandoned
  // split never spends a scan, and the host corrects the parse on a real screen.
  //
  // One short confirmation, replying to the photo the host just posted. The
  // board also gains "receipt attached", but it may be far up the chat by now.
  await ctx
    .reply(t(ctx, 'group.receipt_saved'), {
      parse_mode: 'HTML',
      reply_markup: new InlineKeyboard().url(
        t(ctx, 'group.btn.open'),
        splitAppUrl(ctx, split.id)
      ),
    })
    .catch(() => undefined)

  await refreshGroupBoard(bot, split.id)
}

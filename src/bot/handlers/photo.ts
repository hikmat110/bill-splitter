import type { Bot } from 'grammy'
import type { MyContext } from '../index'
import { t } from '../../i18n'
import { saveImage, StorageError } from '../../services/storage.service'
import { downloadTelegramFile } from '../../services/telegram-file.service'
import { markParticipantPaid, getParticipantById } from '../../services/bill.service'
import { notifyCreatorOfPaymentMark } from '../../services/notification.service'
import { showReview } from './new-bill'

/**
 * Handles incoming photos, but only while a wizard is expecting one:
 *  - mark-paid wizard → attach a transfer-receipt proof to the participant
 *  - bill wizard → attach the main cheque photo to the bill being created
 * Any other photo is ignored silently (it isn't part of a known flow).
 */
export async function photoHandler(ctx: MyContext, bot: Bot<MyContext>): Promise<void> {
  const markPaidWizard = ctx.session.mark_paid_wizard
  const billWizard = ctx.session.bill_wizard

  const expectsProof = markPaidWizard?.step === 'awaiting_proof'
  const expectsReceipt = billWizard?.step === 'awaiting_receipt_photo'

  if (!expectsProof && !expectsReceipt) return

  const photos = ctx.message?.photo
  const ph = photos?.at(-1)
  if (!ph) return

  // Download + persist the photo. Telegram always delivers photos as JPEG.
  let stored
  try {
    const bytes = await downloadTelegramFile(ctx.api, ph.file_id)
    stored = await saveImage(bytes, 'image/jpeg')
  } catch (err) {
    if (err instanceof StorageError) {
      ctx.logger.warn({ code: err.code }, 'photo upload rejected')
    } else {
      ctx.logger.error({ err }, 'photo upload failed')
    }
    await ctx.reply(t(ctx, 'errors.upload_failed'))
    return
  }

  if (expectsProof) {
    const participantId = markPaidWizard!.participantId
    const participant = await getParticipantById(participantId)
    if (!participant || participant.contact.linked_user_id !== ctx.user.id) {
      ctx.session.mark_paid_wizard = undefined
      await ctx.reply(t(ctx, 'errors.not_your_action'))
      return
    }

    ctx.session.mark_paid_wizard = undefined

    if (participant.status !== 'pending') return

    await markParticipantPaid(participantId, { attachmentId: stored.id, mime: stored.mime })
    await notifyCreatorOfPaymentMark(bot, participantId)

    await ctx.reply(t(ctx, 'incoming.proof_received'))
    return
  }

  // Bill wizard receipt step: stash the attachment and advance to review.
  billWizard!.receiptAttachmentId = stored.id
  billWizard!.receiptMime = stored.mime
  billWizard!.step = 'review'
  await showReview(ctx)
}

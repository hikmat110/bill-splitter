import type { MyContext } from '../../index'
import { cancelSplitsForChat } from '../../../services/group-split.service'
import { postGroupIntro } from './help'

const PRESENT = new Set(['member', 'administrator', 'creator'])
const GONE = new Set(['left', 'kicked'])

/**
 * `my_chat_member` — the bot itself was added to or removed from a chat.
 *
 * Service messages are delivered regardless of privacy mode, and this update
 * arrives in Telegram's default `allowed_updates`, so no configuration is
 * needed. Note that `chat_member` (other people joining) is deliberately NOT
 * subscribed to: it requires promoting the bot to admin, and an admin bot
 * receives every message in the group — reinstating exactly the firehose this
 * whole change exists to shut off.
 */
export async function botMembershipHandler(ctx: MyContext): Promise<void> {
  const update = ctx.myChatMember
  if (!update) return

  const was = update.old_chat_member.status
  const now = update.new_chat_member.status

  if (GONE.has(now)) {
    // Cannot edit the card any more, and a live split would keep occupying this
    // chat's open-split slot if the bot is ever added back.
    await cancelSplitsForChat(BigInt(ctx.chat!.id)).catch(() => undefined)
    return
  }

  if (PRESENT.has(now) && !PRESENT.has(was)) {
    // Posting this also makes the bot "the last bot to send a message", which is
    // the condition under which Telegram delivers a bare /split to it.
    //
    // Note this fires only when the bot is ADDED. A group that already had the
    // bot before this feature shipped never sees it — those users reach the
    // same text through START or /help@bot instead.
    await postGroupIntro(ctx)
  }
}

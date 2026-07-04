import type { Api } from 'grammy'
import { config } from '../config'

/**
 * Download a Telegram-hosted file's raw bytes via the Bot API.
 * NOTE: the file URL embeds the bot token — never log it (or `file_path`).
 */
export async function downloadTelegramFile(api: Api, fileId: string): Promise<Uint8Array> {
  const f = await api.getFile(fileId)
  const res = await fetch(`https://api.telegram.org/file/bot${config.BOT_TOKEN}/${f.file_path}`)
  if (!res.ok) throw new Error(`Telegram file download failed (${res.status})`)
  return new Uint8Array(await res.arrayBuffer())
}

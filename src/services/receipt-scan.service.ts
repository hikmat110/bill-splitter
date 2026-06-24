// Receipt scanning via Google Gemini (Flash-Lite, free-tier friendly). Takes raw
// image bytes and asks the model to extract line items, the service charge, and
// the printed total as structured JSON. Pure outbound HTTP (native fetch) — no DB,
// no framework — so it can be unit-tested by stubbing `fetch`.
//
// Privacy note: the image is sent to Google's Gemini API. The whole feature is
// gated by config.GEMINI_API_KEY; when unset, scanReceipt throws 'not_configured'
// and the API surfaces a 503 (see src/server/routes.ts).

import { z } from 'zod'
import { config } from '../config'
import { rootLogger } from '../bot/middleware/logger'
import type { AllowedMime } from './storage.service'

const log = rootLogger.child({ module: 'receipt-scan' })

// Gemini is a slow external call; cap it well under the server's idleTimeout (120s)
// and Telegram's webview patience.
const REQUEST_TIMEOUT_MS = 30_000
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

export interface ScannedItem {
  name: string
  price: number
}

export interface ScannedReceipt {
  items: ScannedItem[]
  /** Service/обслуживание charge as a money amount (UZS); 0 if none printed. */
  serviceAmount: number
  /** Printed service percentage if the receipt states one, else null. */
  servicePct: number | null
  /** Printed grand total — a soft sanity hint for the client, not authoritative. */
  total: number | null
}

export class ReceiptScanError extends Error {
  constructor(
    public code: 'not_configured' | 'upstream' | 'parse',
    message: string
  ) {
    super(message)
    this.name = 'ReceiptScanError'
  }
}

// Money arrives from the model as a plain number; floor float dust to 2 decimals.
const num2 = z
  .number()
  .finite()
  .nonnegative()
  .transform((n) => Math.round(n * 100) / 100)

const scannedReceiptSchema = z.object({
  items: z
    .array(z.object({ name: z.string().trim().max(200).default(''), price: num2 }))
    .default([]),
  serviceAmount: num2.default(0),
  servicePct: z.number().min(0).max(100).nullable().default(null),
  total: z.number().nonnegative().nullable().default(null),
})

// Summary/charge lines the model sometimes lists as items despite the prompt
// (service, total, tax, discount, …). Matched case-insensitively as substrings so
// it works across Latin and Cyrillic without relying on \b word boundaries. The
// list is curated to avoid colliding with real dish names (e.g. no bare "tip" →
// "beef tips", no bare "vat" → "vatrushka") and is easy to extend.
const NON_ITEM_KEYWORDS = [
  'service', 'servis', 'xizmat', 'обслуж', 'сервис',
  'чаевые', 'choy puli',
  'total', 'итог', 'jami', 'umumiy', // 'total' also covers 'subtotal'
  'qqs', 'ндс', 'soliq', 'tax',
  'discount', 'скидк', 'chegirma',
]

function isNonItemLine(name: string): boolean {
  const n = name.toLowerCase()
  return NON_ITEM_KEYWORDS.some((k) => n.includes(k))
}

/**
 * Keep only real ordered products. Drops zero-price rows and summary/charge lines
 * (service, total, tax, …) so a service charge isn't double-counted as both a line
 * item and the service fee — which would also inflate the subtotal the client uses
 * to derive the service percentage.
 */
function cleanItems(items: ScannedItem[], serviceAmount: number): ScannedItem[] {
  let cleaned = items.filter((it) => it.price > 0 && !isNonItemLine(it.name))
  // A service line the model named with only its percent ("15%") or nothing slips
  // past the keyword filter; drop ONE bare-named row that equals the service amount.
  // `bare` = the name has no 3+ letter run, so a real dish that happens to cost
  // exactly the service amount is never removed.
  if (serviceAmount > 0) {
    const bare = (s: string) => !/[\p{L}]{3,}/u.test(s)
    const i = cleaned.findIndex((it) => it.price === serviceAmount && bare(it.name))
    if (i !== -1) cleaned = cleaned.filter((_, idx) => idx !== i)
  }
  return cleaned
}

// Gemini structured-output schema (OpenAPI subset, uppercase type names). NOT a
// Zod schema — the model is constrained to this, and we re-validate with Zod after.
const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING' },
          price: { type: 'NUMBER' },
        },
        required: ['name', 'price'],
      },
    },
    serviceAmount: { type: 'NUMBER' },
    servicePct: { type: 'NUMBER', nullable: true },
    total: { type: 'NUMBER', nullable: true },
  },
  required: ['items', 'serviceAmount'],
} as const

const PROMPT = [
  'You are reading a restaurant bill/receipt photo. Extract the data as JSON.',
  'Rules:',
  '- "items": each ordered line item with its "name" and its line "price" as a bare number.',
  '  If a line shows quantity × unit price, use the line total for that item.',
  '- "serviceAmount": the service charge amount (service / обслуживание / xizmat haqi) if printed, else 0.',
  '- "servicePct": the service charge percentage if the receipt prints one (e.g. 10), else null.',
  '- "total": the printed grand total if present, else null.',
  '- Numbers must be plain: strip thousands separators, spaces inside numbers, and any',
  "  currency suffix (so'm, сум, UZS, ₅). Example: \"120 000 so'm\" -> 120000.",
  '- Do NOT put subtotal, tax/VAT/QQS, discount, service, or total lines into "items".',
  '- If a value is unreadable, omit it (or use 0/null) rather than guessing.',
].join('\n')

/** Pull the model's text output out of a Gemini generateContent response. */
function extractText(payload: unknown): string | null {
  const data = payload as {
    candidates?: { content?: { parts?: { text?: string }[] } }[]
    promptFeedback?: { blockReason?: string }
  }
  if (data.promptFeedback?.blockReason) return null
  const parts = data.candidates?.[0]?.content?.parts
  if (!parts) return null
  const text = parts.map((p) => p.text ?? '').join('').trim()
  return text || null
}

/**
 * Send an image to Gemini and return the extracted receipt data. Throws
 * ReceiptScanError on missing config, upstream/network failure, or unparseable
 * model output. Never logs the image bytes, base64, or the API key.
 */
export async function scanReceipt(
  bytes: Uint8Array,
  mime: AllowedMime
): Promise<ScannedReceipt> {
  const apiKey = config.GEMINI_API_KEY
  if (!apiKey) {
    throw new ReceiptScanError('not_configured', 'GEMINI_API_KEY is not configured')
  }

  const started = Date.now()
  const requestBody = JSON.stringify({
    contents: [
      {
        role: 'user',
        parts: [
          { inlineData: { mimeType: mime, data: Buffer.from(bytes).toString('base64') } },
          { text: PROMPT },
        ],
      },
    ],
    generationConfig: {
      temperature: 0,
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
    },
  })

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  let res: Response
  try {
    res = await fetch(`${GEMINI_BASE}/${config.GEMINI_MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: requestBody,
      signal: controller.signal,
    })
  } catch (e) {
    const aborted = e instanceof Error && e.name === 'AbortError'
    log.error({ err: e, aborted }, 'Gemini request failed')
    throw new ReceiptScanError('upstream', aborted ? 'Receipt scan timed out' : 'Receipt scan request failed')
  } finally {
    clearTimeout(timer)
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    log.error({ status: res.status, detail: detail.slice(0, 500) }, 'Gemini returned an error status')
    throw new ReceiptScanError('upstream', `Gemini API error (${res.status})`)
  }

  let payload: unknown
  try {
    payload = await res.json()
  } catch {
    throw new ReceiptScanError('parse', 'Gemini response was not JSON')
  }

  const text = extractText(payload)
  if (!text) {
    log.warn('Gemini returned no usable text (empty or safety-blocked)')
    throw new ReceiptScanError('parse', 'The receipt could not be read')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new ReceiptScanError('parse', 'Model output was not valid JSON')
  }

  const validated = scannedReceiptSchema.safeParse(parsed)
  if (!validated.success) {
    log.warn({ issues: validated.error.issues }, 'Gemini output failed validation')
    throw new ReceiptScanError('parse', 'Model output did not match the expected shape')
  }

  // Drop zero-price rows and summary/charge lines (service, total, …) so they
  // aren't double-counted against the service fee / total.
  const result: ScannedReceipt = {
    ...validated.data,
    items: cleanItems(validated.data.items, validated.data.serviceAmount),
  }
  log.info({ ms: Date.now() - started, itemCount: result.items.length }, 'Receipt scanned')
  return result
}

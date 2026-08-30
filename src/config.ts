import { z } from 'zod'

const schema = z.object({
  BOT_TOKEN: z.string().min(1, 'BOT_TOKEN is required'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  // Public HTTPS origin of the Mini App (used for the bot's "Open App" button
  // and CORS allow-list). Optional in dev; required for the web_app button to work.
  WEBAPP_URL: z.string().url().optional(),
  // HTTP port for the Mini App API / static server.
  PORT: z.coerce.number().int().positive().default(3000),
  // Directory where uploaded receipt/proof images are stored. Must live on a
  // persistent volume in prod (and be excluded from VCS).
  UPLOAD_DIR: z.string().default('./uploads'),
  // Hard cap on a single uploaded image, in bytes. Default 5 MB.
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(5_000_000),
  // Google AI Studio API key for receipt scanning. Optional: the app boots
  // without it and POST /api/receipts/scan returns 503 when unset (so a
  // privacy-sensitive deploy can simply leave scanning disabled).
  GEMINI_API_KEY: z.string().min(1).optional(),
  // Gemini model used for receipt scanning. 2.5 Flash-Lite is closed to
  // projects created after mid-2026 (Google answers 404), hence 3.5.
  GEMINI_MODEL: z.string().default('gemini-3.5-flash-lite'),
  // Origin the Gemini request is sent to — Google directly by default. Point it
  // at the relay in deploy/cloudflare/gemini-relay.js when Google rejects this
  // server's IP ("User location is not supported"); see deploy/README.md.
  // Origin only: the app appends /v1beta/models/<model>:generateContent.
  GEMINI_BASE_URL: z
    .string()
    .url()
    .transform((s) => s.replace(/\/+$/, ''))
    .default('https://generativelanguage.googleapis.com'),
  // Shared secret the relay checks (sent as `x-relay-secret`). Unset = not sent.
  GEMINI_RELAY_SECRET: z.string().min(1).optional(),
  // Receipt-scan limits (enforced in scan-quota.service). Per user: at most this
  // many scans in any rolling SCAN_RATE_LIMIT_WINDOW_HOURS. 0 = no per-user limit.
  // Note: z.coerce turns an empty `KEY=` line into 0 — comment out for the default.
  SCAN_RATE_LIMIT_PER_USER: z.coerce.number().int().nonnegative().default(6),
  SCAN_RATE_LIMIT_WINDOW_HOURS: z.coerce.number().positive().default(24),
  // All users combined per Gemini free-tier day, which resets at midnight
  // America/Los_Angeles. Google's free tier is 500 RPD; the default leaves
  // headroom for concurrent over-admission. 0 = disabled.
  SCAN_DAILY_GLOBAL_LIMIT: z.coerce.number().int().nonnegative().default(450),
  // 32-byte key for encrypting card numbers at rest (AES-256-GCM). Required —
  // an optional key would silently keep writing plaintext. Losing it makes all
  // encrypted cards unreadable, so back it up outside the server and DB.
  CARD_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-f]{64}$/i, 'must be 64 hex chars — generate with: openssl rand -hex 32'),
  // Set only during key rotation so ciphertexts under the old key still decrypt
  // (see deploy/README.md for the rotation procedure).
  CARD_ENCRYPTION_KEY_PREVIOUS: z
    .string()
    .regex(/^[0-9a-f]{64}$/i, 'must be 64 hex chars')
    .optional(),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
    .default('info'),
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
  ADMIN_TELEGRAM_IDS: z
    .string()
    .optional()
    .transform((val) =>
      val
        ? val
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
            .map(Number)
        : []
    ),
})

const result = schema.safeParse(process.env)

if (!result.success) {
  const errors = result.error.issues
    .map((i) => `  ${i.path.join('.')}: ${i.message}`)
    .join('\n')
  console.error(`Missing or invalid environment variables:\n${errors}`)
  process.exit(1)
}

export const config = result.data

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

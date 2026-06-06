import { z } from 'zod'

const schema = z.object({
  BOT_TOKEN: z.string().min(1, 'BOT_TOKEN is required'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
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

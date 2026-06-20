// Preloaded before tests (see bunfig.toml). Supplies fallback env vars so the
// Zod-validated src/config.ts can load under `bun test` without a real .env.
// Real environment values still take precedence.
process.env.BOT_TOKEN ||= 'test-bot-token'
process.env.DATABASE_URL ||= 'postgres://test:test@localhost:5432/test'
process.env.NODE_ENV ||= 'test'

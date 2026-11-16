// Non-interactive migrator for unattended deploys. Applies every committed SQL
// file under ./src/db/migrations, then exits. Idempotent: drizzle tracks applied
// migrations in its journal, so re-running is a no-op. Run via `bun run db:migrate`.

import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
import { config } from '../config'

const sql = postgres(config.DATABASE_URL, { max: 1 })
await migrate(drizzle(sql), { migrationsFolder: './src/db/migrations' })
await sql.end()
console.log('✓ migrations applied')

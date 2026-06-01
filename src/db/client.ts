import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { config } from '../config'
import * as schema from './schema'

const sql = postgres(config.DATABASE_URL)
export const db = drizzle(sql, { schema })

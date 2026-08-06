// Idempotent backfill: encrypts legacy plaintext rows in cards.number. Safe to
// re-run — already-encrypted rows are skipped (a clean second run reports
// encrypted: 0). With --rotate, re-encrypts every encrypted row under the
// current key instead; run it during key rotation while
// CARD_ENCRYPTION_KEY_PREVIOUS still holds the old key.
//
// Run via `bun run db:encrypt-cards [--rotate]`. Deploy ordering matters: the
// app must already be running code whose reads tolerate both forms (the
// plaintext passthrough in utils/card-crypto) before this runs.

import postgres from 'postgres'
import { config } from '../../config'
import {
  decryptCardNumber,
  encryptCardNumber,
  isEncrypted,
} from '../../utils/card-crypto'

const rotate = process.argv.includes('--rotate')
const sql = postgres(config.DATABASE_URL, { max: 1 })

const rows = await sql<{ id: string; number: string }[]>`SELECT id, number FROM cards`

let encrypted = 0
let rotated = 0
let skipped = 0
let anomalies = 0

for (const row of rows) {
  // The `AND number = <original>` guard makes a concurrent write to the same
  // row harmless: we only replace the exact value we read.
  if (isEncrypted(row.number)) {
    if (!rotate) {
      skipped++
      continue
    }
    try {
      const plain = decryptCardNumber(row.number)
      await sql`UPDATE cards SET number = ${encryptCardNumber(plain)}
        WHERE id = ${row.id} AND number = ${row.number}`
      rotated++
    } catch {
      // Log the row id only — never the stored value.
      console.error(`✗ card ${row.id}: cannot decrypt with available keys`)
      anomalies++
    }
  } else if (/^\d{16}$/.test(row.number)) {
    await sql`UPDATE cards SET number = ${encryptCardNumber(row.number)}
      WHERE id = ${row.id} AND number = ${row.number}`
    encrypted++
  } else {
    console.error(`✗ card ${row.id}: unrecognized number format, left untouched`)
    anomalies++
  }
}

await sql.end()
console.log({ total: rows.length, encrypted, rotated, skipped, anomalies })
process.exit(anomalies > 0 ? 1 : 0)

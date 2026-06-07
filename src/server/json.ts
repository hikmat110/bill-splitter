// JSON helpers for the Mini App API.
//
// Money is stored as `bigint` whole-som throughout the backend, but JSON has no
// bigint type. UZS totals fit comfortably in a JS `number` (consistent with how
// `utils/format.ts` already does `Number(amount)` for display), so we serialize
// every bigint as a number.

function replacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? Number(value) : value
}

export function json(data: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(data, replacer), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...init?.headers,
    },
  })
}

export function error(status: number, message: string): Response {
  return json({ error: message }, { status })
}

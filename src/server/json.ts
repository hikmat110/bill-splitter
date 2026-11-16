// JSON helpers for the Mini App API.
//
// Money is `numeric(14,2)` surfaced as a JS `number`, so it serializes directly.
// The only remaining `bigint`s are ids (telegram_id, notification_message_id);
// JSON has no bigint type, so we serialize every bigint as a number.

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

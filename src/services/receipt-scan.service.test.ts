import { afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { config } from '../config'
import { scanReceipt, ReceiptScanError } from './receipt-scan.service'

// config is a shared singleton (parsed once at import); set the Gemini fields on
// it directly so the test is robust regardless of which test file imported config
// first. test-setup.ts already supplies BOT_TOKEN/DATABASE_URL so config loads.
beforeAll(() => {
  config.GEMINI_API_KEY = 'test-key'
  config.GEMINI_MODEL = 'gemini-test'
})

const IMG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]) // bytes are opaque to the scanner

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

/** Install a stub for the global fetch (the cast is centralized here). */
function mockFetch(fn: (url: string, init: RequestInit) => Promise<Response>): void {
  globalThis.fetch = fn as unknown as typeof fetch
}

/** Build a Gemini generateContent response whose model text is `text`. */
function geminiResponse(text: string): Response {
  return new Response(
    JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }),
    { status: 200 }
  )
}

describe('scanReceipt', () => {
  test('parses items, service, and total; rounds money and drops zero-price rows', async () => {
    mockFetch(async () =>
      geminiResponse(
        JSON.stringify({
          items: [
            { name: 'Plov', price: 45000 },
            { name: 'Tea', price: 12345.678 },
            { name: 'Unreadable', price: 0 },
          ],
          serviceAmount: 9000,
          servicePct: 10,
          total: 99000,
        })
      )
    )

    const result = await scanReceipt(IMG, 'image/jpeg')
    expect(result.items).toEqual([
      { name: 'Plov', price: 45000, quantity: 1 },
      { name: 'Tea', price: 12345.68, quantity: 1 }, // rounded to 2 decimals
    ])
    expect(result.serviceAmount).toBe(9000)
    expect(result.servicePct).toBe(10)
    expect(result.total).toBe(99000)
  })

  test('extracts printed quantities and clamps degenerate values', async () => {
    mockFetch(async () =>
      geminiResponse(
        JSON.stringify({
          items: [
            { name: 'Kebab', price: 70000, quantity: 7 },
            { name: 'Bread', price: 6000, quantity: 0 }, // clamped up to 1
            { name: 'Tea', price: 9000, quantity: 2.6 }, // rounded to 3
          ],
          serviceAmount: 0,
        })
      )
    )
    const result = await scanReceipt(IMG, 'image/jpeg')
    expect(result.items).toEqual([
      { name: 'Kebab', price: 70000, quantity: 7 },
      { name: 'Bread', price: 6000, quantity: 1 },
      { name: 'Tea', price: 9000, quantity: 3 },
    ])
  })

  test('defaults missing optional fields (service/total absent)', async () => {
    mockFetch(async () => geminiResponse(JSON.stringify({ items: [{ name: 'Coffee', price: 25000 }] })))

    const result = await scanReceipt(IMG, 'image/jpeg')
    expect(result.serviceAmount).toBe(0)
    expect(result.servicePct).toBeNull()
    expect(result.total).toBeNull()
  })

  test('drops a named service line that was listed as an item (keyword filter)', async () => {
    mockFetch(async () =>
      geminiResponse(
        JSON.stringify({
          items: [
            { name: 'Plov', price: 45000 },
            { name: 'Service 15%', price: 8550 },
          ],
          serviceAmount: 8550,
          servicePct: 15,
          total: 53550,
        })
      )
    )
    const result = await scanReceipt(IMG, 'image/jpeg')
    expect(result.items).toEqual([{ name: 'Plov', price: 45000, quantity: 1 }])
    expect(result.serviceAmount).toBe(8550) // service fee preserved, not double-counted
    expect(result.servicePct).toBe(15)
  })

  test('drops multilingual summary/charge lines (ru/uz/total/tax)', async () => {
    mockFetch(async () =>
      geminiResponse(
        JSON.stringify({
          items: [
            { name: 'Lagman', price: 40000 },
            { name: 'Обслуживание', price: 6000 },
            { name: 'Xizmat haqi', price: 6000 },
            { name: 'Итого', price: 52000 },
            { name: 'QQS', price: 4000 },
          ],
          serviceAmount: 6000,
        })
      )
    )
    const result = await scanReceipt(IMG, 'image/jpeg')
    expect(result.items).toEqual([{ name: 'Lagman', price: 40000, quantity: 1 }])
  })

  test('drops an unnamed percent-only service line via the price guard', async () => {
    mockFetch(async () =>
      geminiResponse(
        JSON.stringify({
          items: [
            { name: 'Steak', price: 90000 },
            { name: '15%', price: 13500 }, // no keyword, but equals serviceAmount
          ],
          serviceAmount: 13500,
          servicePct: 15,
        })
      )
    )
    const result = await scanReceipt(IMG, 'image/jpeg')
    expect(result.items).toEqual([{ name: 'Steak', price: 90000, quantity: 1 }])
  })

  test('keeps a real dish that happens to equal the service amount', async () => {
    mockFetch(async () =>
      geminiResponse(
        JSON.stringify({
          items: [
            { name: 'Plov', price: 45000 },
            { name: 'Cola', price: 8550 }, // same price as service, but a real name
          ],
          serviceAmount: 8550,
          servicePct: 15,
        })
      )
    )
    const result = await scanReceipt(IMG, 'image/jpeg')
    expect(result.items).toEqual([
      { name: 'Plov', price: 45000, quantity: 1 },
      { name: 'Cola', price: 8550, quantity: 1 },
    ])
  })

  test('keeps all normal items when there is no service charge', async () => {
    mockFetch(async () =>
      geminiResponse(
        JSON.stringify({
          items: [
            { name: 'Tea', price: 12000 },
            { name: 'Cake', price: 23000 },
          ],
          serviceAmount: 0,
        })
      )
    )
    const result = await scanReceipt(IMG, 'image/jpeg')
    expect(result.items).toEqual([
      { name: 'Tea', price: 12000, quantity: 1 },
      { name: 'Cake', price: 23000, quantity: 1 },
    ])
  })

  test('sends the API key via header, not the URL', async () => {
    let seenUrl = ''
    let seenKey = ''
    mockFetch(async (url, init) => {
      seenUrl = String(url)
      seenKey = new Headers(init.headers).get('x-goog-api-key') ?? ''
      return geminiResponse(JSON.stringify({ items: [], serviceAmount: 0 }))
    })

    await scanReceipt(IMG, 'image/jpeg')
    expect(seenKey).toBe('test-key')
    expect(seenUrl).toContain('gemini-test:generateContent')
    expect(seenUrl).not.toContain('test-key')
  })

  test('throws not_configured when the API key is missing', async () => {
    const original = config.GEMINI_API_KEY
    config.GEMINI_API_KEY = undefined
    mockFetch(async () => {
      throw new Error('fetch should not be called when unconfigured')
    })
    try {
      await expect(scanReceipt(IMG, 'image/jpeg')).rejects.toMatchObject({
        code: 'not_configured',
      })
    } finally {
      config.GEMINI_API_KEY = original
    }
  })

  test('throws upstream on a non-2xx response', async () => {
    mockFetch(async () => new Response('rate limited', { status: 429 }))
    const err = await scanReceipt(IMG, 'image/jpeg').catch((e) => e)
    expect(err).toBeInstanceOf(ReceiptScanError)
    expect(err.code).toBe('upstream')
  })

  test('throws parse on malformed model JSON', async () => {
    mockFetch(async () => geminiResponse('{ not json'))
    await expect(scanReceipt(IMG, 'image/jpeg')).rejects.toMatchObject({ code: 'parse' })
  })

  test('throws parse when the model returns no candidates (safety block)', async () => {
    mockFetch(async () =>
      new Response(JSON.stringify({ promptFeedback: { blockReason: 'SAFETY' } }), { status: 200 })
    )
    await expect(scanReceipt(IMG, 'image/jpeg')).rejects.toMatchObject({ code: 'parse' })
  })
})

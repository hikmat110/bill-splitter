import { describe, expect, test } from 'bun:test'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cacheControlFor, readWebappBuild } from './version'

const BUILD = {
  version: '0.1.0',
  stamp: '5e113c9',
  buildId: '0.1.0+5e113c9',
  builtAt: '2026-08-06T00:00:00.000Z',
}

async function distWith(contents: string | null): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'billsplit-version-'))
  if (contents !== null) await writeFile(join(dir, 'version.json'), contents)
  return dir
}

describe('cacheControlFor', () => {
  test('content-hashed assets are immutable', () => {
    expect(cacheControlFor('/assets/index-BmCYojFh.js')).toBe(
      'public, max-age=31536000, immutable'
    )
    expect(cacheControlFor('/assets/tabler-icons-CKaxJfX3.woff2')).toBe(
      'public, max-age=31536000, immutable'
    )
  })

  test('the unhashed shell and everything else must revalidate', () => {
    // This is the header that stops a Telegram webview pinning an old build.
    expect(cacheControlFor('/')).toBe('no-cache')
    expect(cacheControlFor('/index.html')).toBe('no-cache')
    expect(cacheControlFor('/version.json')).toBe('no-cache')
  })
})

describe('readWebappBuild', () => {
  test('reads a build written by the Vite plugin', async () => {
    expect(await readWebappBuild(await distWith(JSON.stringify(BUILD)))).toEqual(BUILD)
  })

  test('missing dist, missing file and malformed JSON all fail open to null', async () => {
    expect(await readWebappBuild('/nonexistent/dist')).toBeNull()
    expect(await readWebappBuild(await distWith(null))).toBeNull()
    expect(await readWebappBuild(await distWith('not json'))).toBeNull()
  })

  test('a version.json without a buildId is null, not a half-built object', async () => {
    // Clients compare buildId; a partial object would compare as "stale" every
    // time and nag forever.
    expect(await readWebappBuild(await distWith(JSON.stringify({ version: '0.1.0' })))).toBeNull()
  })

  test('picks up a rebuild without a restart — the file is re-read per call', async () => {
    const dir = await distWith(JSON.stringify(BUILD))
    expect((await readWebappBuild(dir))?.buildId).toBe('0.1.0+5e113c9')
    await writeFile(join(dir, 'version.json'), JSON.stringify({ ...BUILD, buildId: '0.1.0+next' }))
    expect((await readWebappBuild(dir))?.buildId).toBe('0.1.0+next')
  })
})

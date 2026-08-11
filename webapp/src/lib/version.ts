// Build identity, inlined at compile time by the __APP_BUILD__ define in
// vite.config.ts. The identical object is written to dist/version.json, which
// the server echoes from /health — comparing the two is the whole stale-bundle
// check: one build seen from two vantage points, so they cannot drift.

// Telegram passes initData in the location hash. A reload built from a
// reconstructed URL that loses the hash empties getInitData(), which 401s every
// API call — so capture the launch URL before anything can rewrite it.
const LAUNCH_URL = typeof window === 'undefined' ? '' : window.location.href

export type AppBuild = {
  version: string
  stamp: string
  buildId: string
  builtAt: string
}

// `define` is a bundler transform, so under `bun test` (no bundler) the
// identifier genuinely does not exist — hence the typeof guard.
export const BUILD: AppBuild =
  typeof __APP_BUILD__ === 'undefined'
    ? { version: '0.0.0', stamp: 'dev', buildId: '0.0.0+dev', builtAt: '' }
    : __APP_BUILD__

/** "v0.1.0 · 5e113c9" — the Profile line, and what a bug report should quote. */
export const VERSION_LABEL = `v${BUILD.version} · ${BUILD.stamp}`

/**
 * The buildId of the dist the server is serving right now, or null when it
 * can't be determined — offline, an older server, or a dist built before
 * version.json existed. Callers must treat null as "not stale" and stay quiet.
 */
export async function fetchServerBuildId(): Promise<string | null> {
  try {
    const res = await fetch('/health', { cache: 'no-store' })
    if (!res.ok) return null
    const body = (await res.json()) as { webapp?: { buildId?: string } | null }
    return body.webapp?.buildId ?? null
  } catch {
    return null
  }
}

/**
 * Any difference counts, not just "the server is newer". When only the stamp
 * changes there is no ordering to read, and after a rollback clients running
 * the rolled-back-from bundle should come down to the older one too.
 */
export function isStale(local: string, server: string | null): boolean {
  return server !== null && server !== local
}

/**
 * Attempt 1 is a plain reload: `no-cache` on index.html (src/server/version.ts)
 * makes the browser revalidate, so this normally suffices. Attempt 2 adds a
 * cache-busting query, built from the launch URL so the initData hash survives.
 */
export function reloadForUpdate(target: string, attempt: number): void {
  if (attempt <= 1 || !LAUNCH_URL) {
    window.location.reload()
    return
  }
  try {
    const url = new URL(LAUNCH_URL)
    url.searchParams.set('v', target)
    window.location.replace(url.toString())
  } catch {
    window.location.reload()
  }
}

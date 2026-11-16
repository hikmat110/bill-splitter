// Version reporting for /health, plus the cache policy for the built SPA.
//
// The server never derives the webapp's version — it reads dist/version.json,
// written by the Vite build (webapp/plugins/version.ts). That is deliberate:
// /health must describe the bundle a reloading browser would actually receive,
// which is the bytes on disk, not what this process was started with. Two cases
// make the difference concrete. During a deploy the old process briefly serves
// the new dist, so a process-derived version would tell clients who just loaded
// the new bundle to reload. And if `web:build` fails while pm2 reloads anyway,
// disk still holds the old build — clients running it are then correctly told
// they are current, instead of being sent into a reload loop that can never
// resolve because the reload keeps handing them the same bundle.

import { join } from 'node:path'
import pkg from '../../package.json'

export type WebappBuild = {
  version: string
  stamp: string
  buildId: string
  builtAt: string
}

export const SERVER_BUILD = {
  version: pkg.version,
  // Usually null: the deploy rsync excludes .git, so there is nothing to derive
  // a commit from. Set APP_COMMIT in the environment to have one reported.
  commit: process.env.APP_COMMIT?.trim() || null,
  startedAt: new Date().toISOString(),
}

/**
 * The build currently on disk, or null when it can't be read (never built, or a
 * dist predating this feature) — callers report null and clients treat that as
 * "not stale", so a missing file fails open rather than nagging.
 *
 * Read on every call rather than cached at boot: the file changes underneath a
 * long-lived process on every deploy, and /health is low-volume.
 */
export async function readWebappBuild(dist: string): Promise<WebappBuild | null> {
  try {
    const raw = (await Bun.file(join(dist, 'version.json')).json()) as Partial<WebappBuild>
    if (!raw?.buildId || !raw.version || !raw.stamp) return null
    return {
      version: raw.version,
      stamp: raw.stamp,
      buildId: raw.buildId,
      builtAt: raw.builtAt ?? '',
    }
  } catch {
    return null
  }
}

/**
 * Vite content-hashes everything under /assets, so those URLs can be cached
 * forever — the name changes whenever the bytes do. index.html is the unhashed
 * entry that names them, and a cached copy pins a browser to a build whose
 * assets no longer exist (emptyOutDir wipes them on every build). `no-cache`
 * still stores it but forces revalidation, which is what makes a plain
 * location.reload() trustworthy end to end.
 */
export function cacheControlFor(pathname: string): string {
  return pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache'
}

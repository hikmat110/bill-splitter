// Build identity for the Mini App, resolved once per `vite build` and shipped
// two ways that cannot drift: `define`d into the bundle, and emitted as
// dist/version.json for the server to report from /health. Comparing those two
// is the whole stale-bundle check — one build seen from two vantage points.
//
// This file lives outside `src/` on purpose: `bun run web:build` runs
// `tsc --noEmit` over `include: ["src"]` with no @types/node, so a file under
// src/ importing node:child_process would break the build. Do not move it.

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import type { Plugin } from 'vite'

export type AppBuild = {
  version: string
  stamp: string
  /** The only string the stale check compares. */
  buildId: string
  builtAt: string
}

type Env = Record<string, string | undefined>

/**
 * A short token that is unique per deployable build.
 *
 * The order is load-bearing. `web:build` runs on the VPS, where the deploy
 * rsync has excluded `.git` (docs/deployment-plan.md), so git only answers on a
 * dev machine — and a chain that bottomed out in a constant like 'unknown'
 * would make every comparison trivially equal, silently disabling the check.
 * The timestamp tier is what guarantees uniqueness when nothing else can.
 */
export function resolveStamp(env: Env = process.env, git: () => string | null = gitStamp): string {
  const fromEnv = env.APP_COMMIT?.trim()
  if (fromEnv) return fromEnv.slice(0, 7)
  return git() ?? 'b' + Math.floor(Date.now() / 1000).toString(36)
}

function gitStamp(): string | null {
  try {
    const head = git(['rev-parse', '--short=7', 'HEAD'])
    if (!head) return null
    // Mark uncommitted builds so a local bundle is never mistaken for the
    // committed one it was built from.
    return git(['status', '--porcelain']) ? `${head}-dirty` : head
  } catch {
    // No git binary, or no .git directory — expected on the server.
    return null
  }
}

function git(args: string[]): string {
  return execFileSync('git', args, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
}

/** `builtAt` is deliberately not part of `buildId`: keying the id on the commit
 *  means a no-op rebuild of identical source doesn't nag every open client. */
export function makeBuild(version: string, stamp: string, builtAt: string): AppBuild {
  return { version, stamp, buildId: `${version}+${stamp}`, builtAt }
}

/** Reads the semver from the root package.json — the single source of truth
 *  shared with the server (webapp/package.json stays version-less). */
export function resolveBuild(pkgPath: string | URL, env: Env = process.env): AppBuild {
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string }
  return makeBuild(pkg.version ?? '0.0.0', resolveStamp(env), new Date().toISOString())
}

/** Writes the resolved build to dist/version.json. `generateBundle` doesn't run
 *  under `vite dev`, so the file only appears for a real build. */
export function versionPlugin(build: AppBuild): Plugin {
  return {
    name: 'app-version',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify(build, null, 2) + '\n',
      })
    },
  }
}

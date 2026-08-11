# App version and the stale-bundle check

One version covers bot, API and Mini App — they always ship from one commit. The
semver lives in the **root `package.json`** (`webapp/package.json` stays
version-less) and is bumped by hand at release time; the short commit makes each
build individually identifiable.

The Vite build resolves that identity once and ships it two ways that cannot
drift: inlined into the bundle as `__APP_BUILD__`, and written to
`webapp/dist/version.json`. The server never derives it — `/health` just reports
the file on disk:

```json
{ "status": "ok",
  "server": { "version": "0.1.0", "commit": null, "startedAt": "…" },
  "webapp": { "version": "0.1.0", "stamp": "5e113c9", "buildId": "0.1.0+5e113c9", "builtAt": "…" } }
```

The app compares its own baked-in `buildId` against that one on launch and on
resume, and offers a reload when they differ. Reporting the **dist on disk**
rather than the running process is what keeps that honest: during a deploy the
old process briefly serves the new dist, and if the build fails while PM2
restarts anyway, disk still holds the old build — clients running it are then
correctly told they are current, instead of being sent into a reload loop that
keeps handing them the same bundle.

**`APP_COMMIT` is what makes the stamp traceable.** The stamp resolves from
`APP_COMMIT`, then git, then a timestamp. The deploy builds on the CI runner and
passes `APP_COMMIT=${{ github.sha }}` explicitly; CI passes the PR head sha,
because on a `pull_request` event HEAD is an ephemeral merge commit. Without the
variable the build falls back to a timestamp stamp (`b…`) — still unique per
build, so the check keeps working, but not traceable to a commit.

**Diagnostic:** if `webapp.builtAt` is newer than `server.startedAt`, the SPA was
rebuilt but the process never restarted — a half-finished deploy, visible in one
`curl`.

Two supporting pieces, both in `src/server/`:

- `index.html` is served `no-cache` (revalidate every time) and `/assets/*`
  `immutable` (content-hashed, so the URL changes with the bytes). Without this a
  Telegram webview can cache the unhashed shell and pin itself to a build whose
  assets no longer exist.
- A request for a hashed asset that isn't on disk returns **404**, not the SPA
  fallback. Answering a module-script request with HTML fails on MIME type and
  leaves a white screen; in that state no JS runs, so the update banner cannot
  help — the cache headers are the real fix, the banner only covers clients whose
  old bundle still boots.

nginx deliberately sets no caching headers of its own: it *appends* `add_header`
rather than replacing the upstream's, so a rule there would produce two
contradictory `Cache-Control` values and break the contract above. See
`deploy/nginx/billsplit.arcan.uz.conf`.

The deploy keeps old hashed assets on the server (the rsync never uses
`--delete`), so a webview still holding an old `index.html` keeps working until
the update banner offers it a reload on its own terms. `version.json` is
overwritten in place, so freshness reporting is unaffected.

## Where this lives

| File | Role |
|---|---|
| `webapp/plugins/version.ts` | Resolves the build identity; emits `dist/version.json` |
| `webapp/src/lib/version.ts` | `BUILD`, `VERSION_LABEL`, `isStale`, `reloadForUpdate` |
| `webapp/src/components/UpdateBanner.tsx` | The check loop and the prompt |
| `src/server/version.ts` | `/health`'s payload and the static cache policy |

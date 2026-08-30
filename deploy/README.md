# Deploying Bill Splitter

Production runbook. The bot and the Mini App are **one process** — `src/index.ts`
boots the HTTP server and grammY polling together — so there is one deploy unit,
one PM2 app, and one origin serving both `/api` and the built SPA.

## What's on the box

The VPS is shared with two sibling projects. Nothing here may collide with them.

| | |
|---|---|
| Host | `170.168.60.61`, SSH user `behzodbek_abdurasulov` |
| Deploy path | `/home/behzodbek_abdurasulov/projects/bill-splitter` |
| PM2 app | `bill-splitter` |
| Port | `3003` — 3000 is global-go, 3001 Arcan prod, 3002 Arcan beta |
| Domain | `https://billsplit.arcan.uz` (nginx + certbot) |
| Runtime | Bun at `$HOME/.bun/bin` — **not on the non-interactive PATH**, every remote script must export it |
| Uploads | `<deploy>/uploads` — user receipt images, nothing backs this up |

Neighbours to leave alone: PM2 apps `arcan-vision`, `arcan-vision-beta`,
`global-go-api-stage`, `global-go-bot-stage`, and the vhosts for
`vision.arcan.uz`, `beta.arcan.uz`, `testbot.globalgo.uz`, `office.globalgo.uz`.

## How a deploy runs

**Actions → Deploy — Production → Run workflow**, and pick a branch. There is no
`push:` trigger: merging to `main` ships nothing by itself, and you can deploy a
feature branch without merging. The consequence is that **the live commit is
whatever someone picked** — `curl https://billsplit.arcan.uz/health` is how you
find out what is actually running, and the Telegram notification records the
branch and short SHA of each run.

The workflow: install → typecheck → `bun test` → build the SPA on the runner
(stamped with the commit) → rsync → `bun install` → `db:migrate` →
`pm2 startOrRestart` → health gate → public smoke test → notify.

Two details worth knowing:

- **The SPA is built on the runner**, not here. The box needs no webapp
  devDependencies, and a failed build can't leave new `src/` beside an old
  `dist/`. `webapp/dist` ships inside the same rsync.
- **The rsync never uses `--delete`.** The target holds `.env`, `uploads/`,
  `node_modules/`, and hashed assets from earlier builds. Deleting the first two
  would be unrecoverable; keeping the assets is deliberate — a webview still
  holding an old `index.html` keeps working instead of white-screening, because
  the server 404s missing hashed assets rather than serving HTML for them.

### Required GitHub secrets

`VPS_HOST`, `VPS_USER`, `VPS_PORT` (optional, defaults to 22), `VPS_SSH_KEY`,
`DEPLOY_TELEGRAM_BOT_TOKEN`, `DEPLOY_TELEGRAM_CHAT_ID`.

The Telegram pair is for a **separate notifier bot**, never the app's `BOT_TOKEN`
— otherwise the user-facing bot starts DMing deploy logs. The `VPS_*` values are
shared with the sibling projects; a distinct keypair for this repo would be
better, so one repo can be revoked without rotating everything.

## First-time provisioning

Verify the box first, read-only:

```bash
ss -ltnp | grep -E ':(3000|3001|3002|3003|5432)\b'   # is 3003 free; is Postgres local
pm2 list && pm2 -v                                   # name free; .cjs config support
grep -h DATABASE_URL ~/projects/*/.env               # local or remote Postgres
systemctl cat pm2-behzodbek_abdurasulov | grep -i path   # does boot know ~/.bun/bin
df -h / && free -m
```

Then, **in this order** where marked:

1. **DNS first** — A record `billsplit.arcan.uz` → `170.168.60.61`. Slowest step,
   and certbot's HTTP-01 challenge needs it to resolve.
2. **`openssl rand -hex 32` → back it up in a password manager before it goes
   anywhere else.** This is `CARD_ENCRYPTION_KEY`. It has no default and no
   recovery: a backup taken later cannot decrypt cards already written.
3. `mkdir -p /home/behzodbek_abdurasulov/projects/bill-splitter`
4. Postgres: a **dedicated** role and database.
   ```sql
   CREATE ROLE bill LOGIN PASSWORD '…';
   CREATE DATABASE bill_splitter OWNER bill;
   ```
   If Postgres is local and shared, `REVOKE CONNECT` on the sibling databases so a
   leaked credential here can't read them. If it is remote, `DATABASE_URL` must
   carry `?sslmode=require` — card ciphertext should not cross a network in clear.
5. **Write `<deploy>/.env` before the first PM2 start** — copy
   `deploy/env.production.example`, fill it in, `chmod 600`. An incomplete one
   exits 1 and burns PM2's 10 restarts.
6. `mkdir -p <deploy>/uploads`, owned by the deploy user.
7. Install the vhost from `deploy/nginx/billsplit.arcan.uz.conf`, then
   `sudo nginx -t && sudo systemctl reload nginx`.
8. **certbot after 1 and 7** — `--nginx` edits an existing `server_name` block, so
   it needs the vhost to already be there and the name to resolve.
   `curl -I https://billsplit.arcan.uz/` should now return **502**: that is the
   correct answer, proving TLS and nginx work and only the upstream is missing.
9. Add the six GitHub secrets and create the `production` environment.
10. Run the workflow. `pm2 startOrRestart` performs the initial start; the health
    gate tells you immediately whether it really came up.
11. `pm2 startup` if it isn't already installed for the siblings, then `pm2 save`
    — **after** the first successful start, since `pm2 save` snapshots the live
    process list.
12. **One-time card backfill** (see below).
13. BotFather `/newapp` → `https://billsplit.arcan.uz`, after TLS works. The
    persistent menu button needs nothing — the bot sets it at boot from
    `WEBAPP_URL`.

## Card encryption at rest

`cards.number` is stored encrypted (AES-256-GCM, `src/utils/card-crypto.ts`); the
key never leaves the server `.env`. Reads tolerate legacy plaintext rows until the
backfill runs, so the rollout is zero-downtime — but the **order is load-bearing**:

1. `openssl rand -hex 32` → `CARD_ENCRYPTION_KEY` in the server `.env`. **Back it
   up off the server and outside the DB.** Losing it bricks every stored card.
2. Deploy. From that moment reads accept both forms and all writes encrypt.
3. `bun run db:encrypt-cards` in the deploy dir. Re-run once to confirm it reports
   `encrypted: 0` — that's the idempotency check.
4. **Expire old DB backups.** Any `pg_dump` taken before step 3 contains plaintext
   card numbers; dumps taken after contain only ciphertext.

**Key rotation** (no code changes needed):

1. In `.env`, move the current key to `CARD_ENCRYPTION_KEY_PREVIOUS` and set a new
   `CARD_ENCRYPTION_KEY`.
2. `pm2 restart bill-splitter --update-env` — decryption now tries the new key
   first, then falls back to the old one.
3. `bun run db:encrypt-cards --rotate` — re-encrypts every row under the new key.
4. Remove `CARD_ENCRYPTION_KEY_PREVIOUS`, restart again.

## Gemini receipt scanning

"Scan receipt" in the Mini App uploads the photo to this server, which sends it to
Google's Gemini API (`src/services/receipt-scan.service.ts`) and returns the line
items. Gated by `GEMINI_API_KEY` in the server `.env`; unset = the endpoint answers
503 and the button just fails cleanly. Model is `GEMINI_MODEL`, default
`gemini-3.5-flash-lite` — `gemini-2.5-flash-lite` is closed to projects created
after mid-2026 (Google answers 404).

**Quota.** One scan = one request, regardless of receipt length. The free tier is
500 requests/day, resetting at midnight Pacific = **12:00 Tashkent**; failed and
test requests count. Your live numbers: https://aistudio.google.com/rate-limit.
Paid tier costs ~$0.001 per scan (input $0.30/M, output $2.50/M tokens).

**Diagnosing failures.** The API turns *every* Gemini failure into a 502, so the
status alone says nothing. The real reason is one log line:

```
pm2 logs bill-splitter --nostream --lines 300 | grep -E 'Gemini|Receipt scanned'
```

`Gemini returned an error status` carries Google's `status` and message —
`429 … credits are depleted` (top up), `404 … no longer available` (model),
`400 FAILED_PRECONDITION "User location is not supported"` (see below).

### Relay: when Google rejects the server's IP

`170.168.60.0/24` is a legacy ARIN block transferred to RIPE on 2025-06-30 and
assigned to New Line Solutions (Tashkent) on 2025-09-26. Public geo databases have
caught up; Google's has not — the free tier answers
`User location is not supported for the API use` from this range while the same
key works from any other Tashkent IP. Until Google's data is corrected, the Gemini
call (and **only** that call — Telegram, Postgres, uploads are untouched) can go
through a Cloudflare Worker whose egress Google accepts. The Worker is not a
general proxy: one upstream host, one path prefix, POST only, shared secret
required, stores and logs nothing. The API key stays in this server's `.env` and
travels in the request header as before.

Setup (≈5 minutes, free plan):

1. Cloudflare dashboard → Workers & Pages → Create → *Start with Hello World* →
   Edit code → paste `deploy/cloudflare/gemini-relay.js` → Deploy. Note the URL
   (`https://<name>.<account>.workers.dev`).
2. Worker → Settings → Variables and Secrets → add a **secret** `RELAY_SECRET`
   with the output of `openssl rand -hex 32`.
3. Prove it from the VPS before touching the app (replace the three values):

   ```
   S=<RELAY_SECRET>; KEY=<GEMINI_API_KEY>; W=https://<name>.<account>.workers.dev
   BODY='{"contents":[{"parts":[{"text":"ping"}]}]}'
   curl -s -X POST "$W/v1beta/models/gemini-3.5-flash-lite:generateContent" \
     -H "x-relay-secret: $S" -H "x-goog-api-key: $KEY" \
     -H 'content-type: application/json' -d "$BODY"          # → candidates JSON
   curl -s -X POST "$W/v1beta/models/x:generateContent" -d "$BODY"   # → 403 relay: bad secret
   ```

4. Server `.env`:

   ```
   GEMINI_BASE_URL=https://<name>.<account>.workers.dev
   GEMINI_RELAY_SECRET=<the same value as RELAY_SECRET>
   ```

   then `pm2 restart bill-splitter`, scan a receipt, and confirm `Receipt scanned`
   appears in `pm2 logs`. A `403 relay: bad secret` in the log means the two
   secrets differ.

**Removing it** once Google accepts the IP again: delete the two `.env` lines,
`pm2 restart bill-splitter`. The Worker can stay or be deleted; nothing else
references it.

**Permanent fix** (provider-side, slow): ask New Line Solutions to publish an
RFC 8805 geofeed for `170.168.60.0/24` and submit it to Google, or file Google's
IP-geolocation correction form quoting the range, AS49424, the RIPE `inetnum`
created 2025-09-26, and the exact error above. Privacy note while the relay is
on: receipt images transit Cloudflare on their way to Google.

## Day-2 operations

**What's running?**

```bash
curl -s https://billsplit.arcan.uz/health | jq
pm2 describe bill-splitter
pm2 logs bill-splitter --lines 100
```

`/health` reports `server` (this process) and `webapp` (the dist on disk). If
`webapp.builtAt` is newer than `server.startedAt`, the SPA was rebuilt but the
process never restarted — a half-finished deploy. See `docs/versioning.md`.

**Rollback** — there is none. One working directory, no releases symlink, matching
the sibling projects. The recovery path is to Run workflow again against the last
good branch or tag. Don't pretend otherwise mid-incident.

**Pruning `webapp/dist`** — old hashed assets accumulate ~550 KB per deploy,
deliberately (see above). When `du -sh webapp/dist` passes roughly 200 MB:

```bash
find webapp/dist/assets -type f -mtime +60 -delete
```

Never automate this into the deploy; the point is that old assets outlive the
deploy that replaced them.

**Disk is the shared failure mode.** `uploads/` grows without any retention
policy, `dist` accumulates, and PM2 logs grow forever unless `pm2-logrotate` is
installed. A full disk takes down all three projects and Postgres at once. Check
`df -h` when you're on the box for any other reason.

**Shared PM2 daemon.** `pm2 save` snapshots *all* apps on the box, so a sibling
that happens to be stopped gets that state resurrected on reboot. Never run
`pm2 kill` or `pm2 update` — they bounce every app.

**Shared Bun.** All the apps run whatever `~/.bun/bin/bun` currently is. Upgrading
it for one project upgrades the runtime for all of them, with no CI signal.

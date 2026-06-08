# Automated Deployment for Bill Splitter (Bot + Mini App)

> Status: **partially implemented.** §1 (migrations) is done — see "Implemented" below.
> The CI/deploy workflows and server/HTTPS setup are still to do.

## Context

Today deployment is manual: changed files are copied by hand to the VPS, which is
slow, error-prone, and easy to get out of sync. The bot is already production-shaped
(Bun + TypeScript, PM2 config in `ecosystem.config.cjs`, Zod-validated env, Drizzle
schema).

Since the original plan was written the project gained a **Telegram Mini App**: a
Vite + React SPA in `webapp/`, served by a Bun HTTP server (`src/server`) that runs in
the **same process** as the bot and exposes an `initData`-authenticated JSON API under
`/api`. This changes deployment in two material ways the bot-only plan did not cover:

1. **There is now a build step.** The SPA must be compiled to `webapp/dist` (which is
   gitignored), and that build has to run as part of every deploy.
2. **There is now a public HTTP origin that must be HTTPS.** Telegram refuses to load a
   Mini App over plain HTTP, so the Bun server's `PORT` must sit behind a TLS-terminating
   reverse proxy or tunnel. The earlier claim that this project "serves no static files
   and needs no reverse proxy" is no longer true.

The sibling project **Arcan-vision** already solves the backend half cleanly with
**GitHub Actions → rsync over SSH → PM2** (no Docker) and uses **nginx + certbot** for
its public HTTPS frontend. Both halves map onto bill-splitter.

**Goal:** `git push origin main` → tests run → files sync to the VPS → DB migrates →
webapp builds → PM2 reloads the bot+server → Telegram notification. The repo is already
on GitHub (`hikmat110/bill-splitter`), so Actions works out of the box.

**Confirmed decisions:** generated migration files (not `drizzle-kit push`);
include Telegram deploy notifications; include a first-time server provisioning guide;
the bot and Mini App API run in one PM2 process (`src/index.ts`).

---

## 1. Database migrations (generated files) — ✅ IMPLEMENTED

Previously there were no migration files — `db:push` was used locally, which is
interactive and unsafe for unattended deploys. Now switched to committed SQL migrations
+ a non-interactive migrator, mirroring Arcan's `bun run migrate`.

What was added:

- **`src/db/migrate.ts`** — runs the postgres-js migrator against `./src/db/migrations`,
  then closes the connection, reusing `config.DATABASE_URL`.
- **`package.json` script** — `"db:migrate": "bun run src/db/migrate.ts"`
  (`db:generate` / `db:push` / `db:studio` kept for local use).
- **`src/db/migrations/0000_*.sql` + `meta/`** — the initial generated migration,
  committed. Covers all 6 tables (`users`, `contacts`, `bills`, `bill_items`,
  `bill_item_shares`, `bill_participants`) with FKs and unique constraints.

From now on the workflow is: edit `schema.ts` → `bun run db:generate` locally →
commit the migration → deploy runs `bun run db:migrate` on the server.

> Not yet verified against a live Postgres on this machine (no local PG/Docker here).
> The first deploy's `bun run db:migrate` is the live apply + idempotency check
> (see Verification §3).

---

## 2. CI workflow — `.github/workflows/ci.yml`

Runs on every PR to `main` so broken code is caught before it can be deployed.
Modeled on Arcan's `ci.yml`, single-app, but with **both** the backend and the webapp
gated.

- Trigger: `pull_request: branches: [main]`
- One job on `ubuntu-latest`:
  - `actions/checkout@v4`
  - `oven-sh/setup-bun@v2` (bun-version: latest)
  - `actions/cache@v4` keyed on `bun.lock` + `webapp/bun.lock` (path `~/.bun/install/cache`)
  - `bun install --frozen-lockfile`
  - `bun run typecheck`
  - `bun test`  ← test files under `src/**` and `webapp/src/**`
  - `bun --cwd webapp install --frozen-lockfile`
  - `bun run web:build`  ← fail the PR if the SPA doesn't compile

---

## 3. Deploy workflow — `.github/workflows/deploy.yml`

Modeled on Arcan's `deploy-prod.yml`, collapsed to a single job that handles both the
bot and the SPA (they ship together in one process). Drop `dorny/paths-filter`.

- Trigger: `push: branches: [main]` **and** `workflow_dispatch` (manual button)
- **Job `deploy`** (`environment: production`):
  1. Checkout
  2. `oven-sh/setup-bun@v2`
  3. `bun install --frozen-lockfile`
  4. `bun run typecheck` + `bun test` + `bun --cwd webapp install --frozen-lockfile`
     + `bun run web:build`  ← gate: never deploy a failing build
  5. **Setup SSH** — write `VPS_SSH_KEY` to `~/.ssh/id_rsa` (chmod 600),
     `ssh-keyscan` the host into `known_hosts`
  6. **rsync** repo → server, **excluding** `.git`, `node_modules`, `.env`,
     `.github`. Note: `--exclude='node_modules'` matches at any depth, so
     `webapp/node_modules` is excluded too and rebuilt server-side. `webapp/dist` is
     gitignored / not built into the synced tree — it is built on the server in step 7,
     so the running SPA always matches the deployed source:

     ```bash
     rsync -rlz --no-perms --no-owner --no-group --omit-dir-times \
       --exclude='.git' --exclude='node_modules' --exclude='.env' --exclude='.github' \
       -e "ssh -p ${{ secrets.VPS_PORT || 22 }} -i ~/.ssh/id_rsa" \
       ./ "${{ secrets.VPS_USER }}@${{ secrets.VPS_HOST }}:${{ secrets.VPS_DEPLOY_PATH }}/"
     ```
     (No `--delete`, matching Arcan's backend sync — protects the server `.env`.)
  7. **Remote install + build + migrate + reload** via `appleboy/ssh-action@v1`:

     ```bash
     set -e
     export PATH="$HOME/.bun/bin:$PATH"
     cd "${{ secrets.VPS_DEPLOY_PATH }}"
     bun install --frozen-lockfile
     bun --cwd webapp install --frozen-lockfile
     bun run web:build                      # compiles webapp/dist served by src/server
     bun run db:migrate
     pm2 startOrReload ecosystem.config.cjs --update-env
     pm2 save
     echo "✓ Bot + Mini App deployed"
     ```
     `pm2 startOrReload` starts the app on first deploy and zero-downtime reloads
     it thereafter. Uses the existing `ecosystem.config.cjs` unchanged — it runs
     `src/index.ts`, which boots both the HTTP server and bot polling.

- **Job `notify`** (`needs: [deploy]`, `if: always()`): build a status message and
  send it with `appleboy/telegram-action@master` to `TELEGRAM_CHAT_ID` /
  `TELEGRAM_BOT_TOKEN` (overall status + repo/branch/short-SHA/actor + run URL).

### GitHub secrets to create (Settings → Secrets → Actions)

| Secret | Purpose |
|---|---|
| `VPS_HOST` | server IP / hostname |
| `VPS_PORT` | SSH port (optional, defaults to 22) |
| `VPS_USER` | SSH user |
| `VPS_SSH_KEY` | private half of the deploy keypair |
| `VPS_DEPLOY_PATH` | absolute project dir on the server, e.g. `/home/<user>/projects/bill-splitter` |
| `TELEGRAM_BOT_TOKEN` | bot that sends deploy notices (can reuse the bill-splitter bot token) |
| `TELEGRAM_CHAT_ID` | your personal/admin chat id to receive notices |

`WEBAPP_URL` and `PORT` are **not** secrets — they live in the server-side `.env`
(see §5), because the bot reads them at runtime to set the Mini App menu button.

---

## 4. HTTPS public origin (new — required by the Mini App)

The Bun server listens on `PORT` (default 3000) and serves the SPA at `/` plus the API
at `/api` from a **single origin**. `WEBAPP_URL` must be exactly that public HTTPS origin
— the bot uses it for the "🚀 Open App" button and `setChatMenuButton`, and the server
uses it for the CORS allow-list. Pick one of two routes (route choice is independent of
the deploy workflow, which only needs the Bun process running on `PORT`):

**Option A — nginx + certbot (recommended; matches Arcan).**
- A/AAAA record for a (sub)domain, e.g. `splitwell.example.com`, → the VPS.
- nginx `server` block: TLS via Let's Encrypt (`certbot --nginx`), `proxy_pass` to
  `http://127.0.0.1:<PORT>`, forwarding `Host` and `X-Forwarded-*`. Bind the Bun port to
  localhost so it isn't reachable except through nginx.
- `WEBAPP_URL=https://splitwell.example.com`.

**Option B — Cloudflare tunnel (simplest; no open inbound ports).**
- `cloudflared tunnel` → `http://localhost:<PORT>`, run as its own service/PM2 app.
- `WEBAPP_URL` = the tunnel's stable hostname.

Either way the same Telegram requirement holds: a valid HTTPS cert (no self-signed).

---

## 5. First-time server provisioning (one-time, documented in README)

Add a **"Deployment"** section to `README.md` covering the manual prep that must
exist before the first automated deploy:

1. **Install Bun:** `curl -fsSL https://bun.sh/install | bash`
2. **Install PM2:** `bun install -g pm2` (lands in `~/.bun/bin`, already on the
   PATH the deploy script exports).
3. **PostgreSQL:** install/provision PG 16, create the `bill_splitter` DB + user.
4. **Create the deploy dir** matching `VPS_DEPLOY_PATH`.
5. **Public HTTPS origin:** set up nginx + certbot (Option A) or a cloudflared tunnel
   (Option B) per §4, terminating TLS in front of the Bun `PORT`.
6. **Create `.env` on the server** (never synced, never in git) with production
   values: `BOT_TOKEN`, `DATABASE_URL`, `NODE_ENV=production`, `LOG_LEVEL=info`,
   `ADMIN_TELEGRAM_IDS`, **`PORT`** (must match what the proxy/tunnel forwards to), and
   **`WEBAPP_URL`** (the public HTTPS origin from step 5).
7. **Deploy SSH key:** generate a keypair, add the public key to the server's
   `~/.ssh/authorized_keys`, store the private key as the `VPS_SSH_KEY` secret.
8. **Boot persistence:** run `pm2 startup` once (and `pm2 save` after first deploy)
   so the bot restarts on server reboot.
9. **BotFather (optional):** `/newapp` to register a named Mini App for a direct
   `t.me/<bot>/<app>` link. The persistent menu button is already set automatically at
   boot from `WEBAPP_URL`, so this is only for the named short link.
10. **Kick it off:** push to `main` (or use the manual *Run workflow* button). The
    first run's remote step builds `webapp/dist` and `pm2 startOrReload` performs the
    initial `pm2 start`.

---

## Critical files

| File | Change |
|---|---|
| `src/db/migrate.ts` | ✅ added — non-interactive migrator |
| `src/db/migrations/**` | ✅ added — generated initial migration (committed) |
| `package.json` | ✅ added `db:migrate` script (`web:build` already present) |
| `.github/workflows/ci.yml` | **new** — typecheck + test + webapp build on PRs |
| `.github/workflows/deploy.yml` | **new** — rsync + webapp build + migrate + PM2 reload + notify |
| `README.md` | add Deployment / server-setup section (incl. HTTPS + `WEBAPP_URL`) |
| nginx site / cloudflared config | **new (server-side)** — HTTPS in front of `PORT` |
| `ecosystem.config.cjs` | unchanged (used as-is by the deploy script) |

---

## Verification

1. **Local sanity before pushing:**
   - `bun run typecheck && bun test` both green (currently: typecheck clean, 75 tests pass)
   - `bun --cwd webapp install && bun run web:build` produces `webapp/dist` (verified)
   - Against a scratch DB: `bun run db:migrate` applies cleanly and is idempotent
     (second run is a no-op) — **still to run on a real PG**
   - visual/yaml check of both workflow files
2. **Pipeline dry run:** open a PR → confirm `ci.yml` runs typecheck + test + web build.
3. **First deploy:** complete provisioning, add all secrets, then use the **Run
   workflow** button. Watch the Actions log: rsync → `bun install` → webapp build →
   `bun run db:migrate` → `pm2 startOrReload` all succeed, and a Telegram success
   notification arrives.
4. **Mini App end-to-end:** open the bot in Telegram, tap the menu button / "Open App",
   confirm the SPA loads over HTTPS and `/api` calls succeed (authenticated via
   `initData`). Create/settle a bill through the app.
5. **Bot end-to-end:** make a trivial change, `git push origin main`, confirm the
   process reloads on the VPS (`pm2 list` shows it online with a bumped restart count)
   and the bot responds in Telegram.
6. **Safety check:** confirm the server `.env` is untouched after a deploy (excluded from
   rsync) and the bot + Mini App are back online within seconds.

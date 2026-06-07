# Automated Deployment for Bill Splitter Bot

> Status: **planned, not yet implemented.** Saved for later execution.

## Context

Today deployment is manual: changed files are copied by hand to the VPS, which is
slow, error-prone, and easy to get out of sync. The bot is already production-shaped
(Bun + TypeScript, PM2 config in `ecosystem.config.cjs`, Zod-validated env, Drizzle
schema) but has **no CI/CD, no migration files, and no deploy automation**.

The sibling project **Arcan-vision** already solves this cleanly with
**GitHub Actions → rsync over SSH → PM2**, no Docker. Both projects are Bun +
TypeScript, so that approach maps almost directly onto bill-splitter — minus the
frontend/nginx half, since a long-polling Telegram bot serves no static files and
needs no reverse proxy.

**Goal:** `git push origin main` → tests run → files sync to the VPS → DB migrates →
PM2 reloads the bot → Telegram notification. The repo is already on GitHub
(`hikmat110/bill-splitter`), so Actions works out of the box.

**Confirmed decisions:** generated migration files (not `drizzle-kit push`);
include Telegram deploy notifications; include a first-time server provisioning guide.

---

## 1. Database migrations (generated files)

Currently there are no migration files — `db:push` is used locally, which is
interactive and unsafe for unattended deploys. Switch to committed SQL migrations +
a non-interactive migrator, mirroring Arcan's `bun run migrate`.

- **New file `src/db/migrate.ts`** — runs the postgres-js migrator against
  `./src/db/migrations`, then closes the connection. Reuse the existing
  `config.DATABASE_URL` from `src/config.ts` (same pattern as `src/db/client.ts`):

  ```ts
  import { drizzle } from 'drizzle-orm/postgres-js'
  import { migrate } from 'drizzle-orm/postgres-js/migrator'
  import postgres from 'postgres'
  import { config } from '../config'

  const sql = postgres(config.DATABASE_URL, { max: 1 })
  await migrate(drizzle(sql), { migrationsFolder: './src/db/migrations' })
  await sql.end()
  console.log('✓ migrations applied')
  ```

- **`package.json` scripts** — add:
  - `"db:migrate": "bun run src/db/migrate.ts"`
  - (keep `db:generate`, `db:push`, `db:studio` for local use)

- **Generate the initial migration** during implementation:
  `bun run db:generate` → creates `src/db/migrations/0000_*.sql` + `meta/`.
  Commit these files. `.gitignore` already keeps them in (only `dist`/`out` are ignored).

- From now on the workflow is: edit `schema.ts` → `bun run db:generate` locally →
  commit the migration → deploy runs `bun run db:migrate` on the server.

---

## 2. CI workflow — `.github/workflows/ci.yml`

Runs on every PR to `main` so broken code is caught before it can be deployed.
Modeled on Arcan's `ci.yml` but single-app (no monorepo path filtering needed).

- Trigger: `pull_request: branches: [main]`
- One job on `ubuntu-latest`:
  - `actions/checkout@v4`
  - `oven-sh/setup-bun@v2` (bun-version: latest)
  - `actions/cache@v4` keyed on `bun.lock` (path `~/.bun/install/cache`)
  - `bun install --frozen-lockfile`
  - `bun run typecheck`
  - `bun test`  ← 5 test files already exist under `src/utils/`

---

## 3. Deploy workflow — `.github/workflows/deploy.yml`

Modeled directly on Arcan's `deploy-prod.yml`, collapsed to a single backend-style
job (drop the frontend job, drop nginx, drop `dorny/paths-filter`).

- Trigger: `push: branches: [main]` **and** `workflow_dispatch` (manual button)
- **Job `deploy`** (`environment: production`):
  1. Checkout
  2. `oven-sh/setup-bun@v2`
  3. `bun install --frozen-lockfile`
  4. `bun run typecheck` + `bun test`  ← gate: never deploy a failing build
  5. **Setup SSH** — write `VPS_SSH_KEY` to `~/.ssh/id_rsa` (chmod 600),
     `ssh-keyscan` the host into `known_hosts` (same snippet as Arcan)
  6. **rsync** repo → server, **excluding** `.git`, `node_modules`, `.env`,
     `.github`, so the server-side `.env` is never touched and deps are rebuilt server-side:

     ```bash
     rsync -rlz --no-perms --no-owner --no-group --omit-dir-times \
       --exclude='.git' --exclude='node_modules' --exclude='.env' --exclude='.github' \
       -e "ssh -p ${{ secrets.VPS_PORT || 22 }} -i ~/.ssh/id_rsa" \
       ./ "${{ secrets.VPS_USER }}@${{ secrets.VPS_HOST }}:${{ secrets.VPS_DEPLOY_PATH }}/"
     ```
     (No `--delete`, matching Arcan's backend sync — protects the server `.env`.)
  7. **Remote install + migrate + reload** via `appleboy/ssh-action@v1`:

     ```bash
     set -e
     export PATH="$HOME/.bun/bin:$PATH"
     cd "${{ secrets.VPS_DEPLOY_PATH }}"
     bun install --frozen-lockfile
     bun run db:migrate
     pm2 startOrReload ecosystem.config.cjs --update-env
     pm2 save
     echo "✓ Bot deployed"
     ```
     `pm2 startOrReload` starts the app on first deploy and zero-downtime reloads
     it thereafter, so the same workflow handles both cases. Uses the existing
     `ecosystem.config.cjs` unchanged.

- **Job `notify`** (`needs: [deploy]`, `if: always()`): build a status message and
  send it with `appleboy/telegram-action@master` to `TELEGRAM_CHAT_ID` /
  `TELEGRAM_BOT_TOKEN`. Simplify Arcan's notify block to a single app
  (overall status + repo/branch/short-SHA/actor + run URL).

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

---

## 4. First-time server provisioning (one-time, documented in README)

Add a **"Deployment"** section to `README.md` covering the manual prep that must
exist before the first automated deploy:

1. **Install Bun:** `curl -fsSL https://bun.sh/install | bash`
2. **Install PM2:** `bun install -g pm2` (lands in `~/.bun/bin`, already on the
   PATH the deploy script exports). The bot runs under Bun via
   `interpreter: 'bun'` in `ecosystem.config.cjs`.
3. **PostgreSQL:** install/provision PG 16, create the `bill_splitter` DB + user.
4. **Create the deploy dir** matching `VPS_DEPLOY_PATH`.
5. **Create `.env` on the server** (never synced, never in git) with production
   values: `BOT_TOKEN`, `DATABASE_URL`, `NODE_ENV=production`, `LOG_LEVEL=info`,
   `ADMIN_TELEGRAM_IDS`.
6. **Deploy SSH key:** generate a keypair, add the public key to the server's
   `~/.ssh/authorized_keys`, store the private key as the `VPS_SSH_KEY` secret.
7. **Boot persistence:** run `pm2 startup` once (and `pm2 save` after first deploy)
   so the bot restarts on server reboot.
8. **Kick it off:** push to `main` (or use the manual *Run workflow* button). The
   first run's `pm2 startOrReload` performs the initial `pm2 start`.

---

## Critical files

| File | Change |
|---|---|
| `src/db/migrate.ts` | **new** — non-interactive migrator |
| `src/db/migrations/**` | **new** — generated initial migration (committed) |
| `package.json` | add `db:migrate` script |
| `.github/workflows/ci.yml` | **new** — typecheck + test on PRs |
| `.github/workflows/deploy.yml` | **new** — rsync + migrate + PM2 reload + notify |
| `README.md` | add Deployment / server-setup section |
| `ecosystem.config.cjs` | unchanged (used as-is by the deploy script) |

---

## Verification

1. **Local sanity before pushing:**
   - `bun run db:generate` then confirm `src/db/migrations/0000_*.sql` looks right
   - `bun run typecheck && bun test` both green
   - Against a scratch DB: `bun run db:migrate` applies cleanly and is idempotent
     (second run is a no-op)
   - `yamllint`/visual check of both workflow files
2. **Pipeline dry run:** open a PR → confirm `ci.yml` runs typecheck + test.
3. **First deploy:** complete the server provisioning steps, add all secrets, then
   use the **Run workflow** button (`workflow_dispatch`). Watch the Actions log:
   rsync → `bun install` → `bun run db:migrate` → `pm2 startOrReload` all succeed,
   and a Telegram success notification arrives.
4. **End-to-end:** make a trivial change, `git push origin main`, confirm the bot
   reloads on the VPS (`pm2 list` shows it online with a bumped restart count) and
   responds in Telegram.
5. **Safety check:** confirm the server `.env` is untouched after a deploy
   (it's excluded from rsync) and that the bot is back online within seconds.

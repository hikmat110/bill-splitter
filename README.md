# Bill Splitter Bot

Telegram bot for splitting bills among friends in Uzbekistan.

## Local Setup

### Prerequisites
- [Bun](https://bun.sh) (installed via `curl -fsSL https://bun.sh/install | bash`)
- [Docker](https://www.docker.com) (for PostgreSQL)
- A Telegram bot token from [@BotFather](https://t.me/BotFather)

### Steps

```bash
# 1. Install dependencies
bun install

# 2. Copy env file and fill in BOT_TOKEN
cp .env.example .env

# 3. Start PostgreSQL
docker compose up -d postgres

# 4. Push schema to the database
bun run db:push

# 5. Run the bot in watch mode
bun run dev
```

### Other commands

```bash
bun run typecheck      # type-check without running
bun run db:generate    # generate migration files
bun run db:studio      # open Drizzle Studio in browser
```

## Telegram Mini App

A Vite + React + TypeScript Mini App lives in `webapp/`, served by an HTTP server that
runs in the same process as the bot (`src/server`, started from `src/index.ts`). It is
wired to the real backend via a Telegram `initData`-authenticated JSON API under `/api`.

```bash
# 1. Install web deps (once)
bun --cwd webapp install

# 2. Run the bot + API server (serves /api on PORT, default 3000)
bun run dev

# 3. In another terminal, run the Vite dev server (proxies /api → :3000)
bun run web:dev        # http://localhost:5173

# Build the SPA for production (output: webapp/dist, served by src/server in prod)
bun run web:build

# The build stamps a version into the bundle and into webapp/dist/version.json
# (reported by /health, shown at the bottom of Profile). It reads the commit
# from git; where there is no .git — notably the VPS — pass it explicitly:
APP_COMMIT=$(git rev-parse --short HEAD) bun run web:build
```

Telegram requires **HTTPS** for Mini Apps. In development, expose the Vite dev server
through a tunnel (e.g. `cloudflared tunnel --url http://localhost:5173`) and set
`WEBAPP_URL` to the tunnel URL in `.env` — that enables the bot's "🚀 Open App" button and
the chat menu button. Registration stays a bot-only flow; the app requires a registered
user.

Features the design includes but the bot doesn't yet support are documented in
`webapp/DEFERRED-FEATURES.md`.

## Deployment

Production runs at **https://billsplit.arcan.uz** — one process serving both the bot and
the Mini App, behind nginx on a VPS shared with two sibling projects.

Deploys are **manual**: Actions → *Deploy — Production* → **Run workflow**, picking a
branch. There is no push trigger, so merging to `main` ships nothing by itself. The run
builds the SPA, rsyncs, migrates, restarts PM2, and then health-gates itself before
reporting to Telegram.

See **`deploy/README.md`** for the server layout, required secrets, first-time
provisioning, the card-encryption key procedure, and day-2 operations.
`docs/versioning.md` explains what `/health` reports and how the stale-bundle check works.

## Project Structure

See `CLAUDE.md` for full architecture, schema, and flow documentation.

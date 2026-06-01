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

## Project Structure

See `CLAUDE.md` for full architecture, schema, and flow documentation.

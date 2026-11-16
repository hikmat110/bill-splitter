// PM2 config for the VPS. Must stay .cjs — package.json is `"type": "module"`,
// so a .js file here would be parsed as ESM and `module.exports` would throw.
module.exports = {
  apps: [
    {
      name: 'bill-splitter',
      script: 'src/index.ts',
      interpreter: 'bun',
      // Pin the working directory. UPLOAD_DIR's default resolves against
      // process.cwd() and Bun loads .env from it, so a `pm2 resurrect` at boot
      // replaying a saved cwd could otherwise boot without .env and put user
      // uploads somewhere else entirely.
      cwd: __dirname,
      watch: false,
      restart_delay: 3000,
      max_restarts: 10,
      // max_restarts only counts *unstable* restarts — ones where the process
      // died within min_uptime, which defaults to 1s. src/config.ts exits 1 at
      // import time on a bad .env, well under that, but restart_delay makes PM2
      // measure uptime from after the delay, so none of those crashes counted
      // and it looped ~42k times instead of stopping at 10 (prod, 2026-08-13:
      // CARD_ENCRYPTION_KEY missing). 10s is far above this app's boot time, so
      // a fail-fast config error now errors out after ~30s of retries.
      min_uptime: '10s',
      // Timestamped logs, and a ceiling that keeps one runaway process from
      // taking down the other projects sharing this box.
      time: true,
      max_memory_restart: '400M',
      env: {
        NODE_ENV: 'production',
        LOG_LEVEL: 'info',
      },
    },
  ],
}

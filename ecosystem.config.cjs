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

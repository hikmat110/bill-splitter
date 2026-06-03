module.exports = {
  apps: [
    {
      name: 'bill-splitter',
      script: 'src/bot/index.ts',
      interpreter: 'bun',
      watch: false,
      restart_delay: 3000,
      max_restarts: 10,
      env: {
        NODE_ENV: 'production',
        LOG_LEVEL: 'info',
      },
    },
  ],
}

module.exports = {
  apps: [
    {
      name: 'status',
      script: 'server.js',
      env: {
        PORT: 3000,
        // PM2の実際のプロセス名に合わせて process を変更してください。
        STATUS_SERVICES: JSON.stringify([
          { id: 'website', type: 'http', url: 'https://morixxx.com/' },
          { id: 'bot', type: 'pm2', process: 'discord-bot' },
          { id: 'api', type: 'pm2', process: 'api' },
          { id: 'mail', type: 'systemd', service: 'postfix.service' },
        ]),
      },
    },
  ],
};

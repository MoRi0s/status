# status

Ubuntuサーバー自身の情報を表示するステータスページです。

## 起動

```bash
npm install
PORT=4000 npm start
```

`/api/status` がCPU、メモリ、ディスク、温度、OS、ネットワーク、OS稼働時間を取得します。データは同一サーバー上で取得するため、外部からSSHや監視エージェントを公開する必要はありません。

サービスの状態は1分ごとに記録され、UptimeのToday／7日／30日／90日に反映されます。`(obs.)` は監視開始から対象期間がまだ経過していないことを表します。

## サービス監視の設定

監視したいHTTP(S)エンドポイントを、Ubuntuサーバーの環境変数に設定します。

```bash
export STATUS_SERVICES='[{"id":"website","type":"http","url":"https://morixxx.com/"},{"id":"bot","type":"systemd","service":"discord-bot.service"},{"id":"api","type":"http","url":"http://127.0.0.1:3001/health"},{"id":"mail","type":"systemd","service":"postfix.service"}]'
npm start
```

`id` は `website`、`bot`、`api`、`mail` を使用します。監視タイプは次の4つです。

- `http`: HTTP(S)の応答を確認します。APIやWebサイト向けです。
- `systemd`: `systemctl is-active` でUbuntuサービスを確認します。Discord BotやPostfix向けです。
- `pm2`: `pm2 jlist` でPM2プロセスの `online` 状態を確認します。Discord BotやAPI向けです。
- `tcp`: 指定ポートに接続できるか確認します。`host` と整数の `port` を指定します。

実際のPM2プロセス名やsystemdサービス名に合わせて設定を書き換えてください。設定例は `services.example.json` にもあります。

## PM2での起動

```bash
cp ecosystem.config.example.cjs ecosystem.config.cjs
nano ecosystem.config.cjs
pm2 start ecosystem.config.cjs
pm2 save
```

`ecosystem.config.cjs` の `process` は、`pm2 list` に表示されるBot・APIの名前と完全に一致させてください。設定を変更した場合は、`pm2 reload status --update-env` を実行します。

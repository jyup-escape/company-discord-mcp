# Cloudflare公開後のDiscord設定

公開先: https://company-discord-mcp.desudesu2387.workers.dev

Discordアプリの設定4項目は反映済みで、公開先の稼働確認は200を返す。Discordへの認証戻り先の登録と社員の実ログインの確認が残っている。以下に初回導入の手順を記載する。パソコンを稼働させ続ける必要はない。

## Discordアプリの作成

1. https://discord.com/developers/applications を開く。
2. `New Application`からアプリを作成する。名称の例は「会社Discord MCP」。
3. `General Information`の`Application ID`を控える。
4. `OAuth2`で`Client Secret`を取得する。秘密情報の生成や追加認証が求められた場合は管理者本人が操作する。
5. `Bot`でBotを用意し、`Token`を取得する。再取得の操作は既存のトークンを無効化するため、既存アプリでは扱いを確認する。
6. `Bot`の`Privileged Gateway Intents`にある`Message Content Intent`を有効にする。MCPによる本文の閲覧に使用する。
7. `OAuth2`の`Redirects`へ次のURLを登録して保存する。

   `https://company-discord-mcp.desudesu2387.workers.dev/oauth/discord/callback`

8. `OAuth2 URL Generator`で`bot`の範囲と、`View Channels`、`Read Message History`、`Send Messages`の権限を選択する。生成されたURLを開き、対象のDiscordサーバーへ招待する。`Administrator`は選択しない。
9. Discordの設定で開発者モードを有効にし、対象サーバーのメニューからサーバーIDをコピーする。
10. サーバーに顧客やゲストがいる場合は、利用を許可する社員ロールのIDを控える。社員ロールIDを空欄にすると参加者全員が利用対象になる。

## 設定と公開先への反映

ローカルの取得先で次を順に実行する。

```powershell
npm run configure
npm run doctor
npm run deploy:cloudflare
```

`configure`では公開URLの現在値をEnterで保持し、Application ID、Client Secret、Bot Token、サーバーIDを入力する。秘密情報は入力中に表示されない。既に生成した暗号鍵を変更しない。

`doctor`がBot参加や権限の不備を報告した場合は、Discord側を修正してから再実行する。Client Secretと認証戻り先の組合せは社員の実ログインで確認する。

このチャットの出力先には「Discord設定と反映.cmd」も用意している。これを開くと、上記の入力、診断、反映を順に実施し、途中の失敗で停止する。

秘密情報をチャット、仕様書、GitHubへ記載しない。Cloudflareへの反映は暗号鍵とDiscord設定をWorkersの秘密情報として登録する処理である。

## 社員側の接続

MCPへ登録するURL:

`https://company-discord-mcp.desudesu2387.workers.dev/mcp`

社員は自分のDiscordアカウントでログインする。本人とBotの両方がアクセスできるチャンネルが対象になる。Gatewayを使用しないCloudflare経路ではBotの表示はオフラインになるが、MCPの要求はREST APIで処理する。

接続後は`discord_whoami`、チャンネル一覧、メッセージ閲覧を確認する。実際の投稿の確認は送信先と本文を指定してから行う。

## 稼働と料金

Cloudflareへ公開済みのため、パソコンの停止後も公開先を利用できる。要求に応じて処理を実行し、無通信の間に外部から定期呼出しを行う設定は加えていない。

無料枠には上限がある。Workersは100,000要求/日、HTTP要求ごとにCPU時間10ms。SQLite形式のDurable Objectsにも要求、実行時間、保存量、読出し・書込みの上限がある。枠を超えると処理が失敗する。有料プランへの変更は行っていない。無料提供の継続や無停止を保証するものではない。

Cloudflareの`Workersのプラン`と使用量の画面で状態を確認できる。公開先の`/healthz`はHTTP処理の稼働確認であり、Discordの認証情報や権限の確認ではない。

仕様の詳細は`deployment-specification.md`、変更記録は`deployment-changes-2026-10-10.md`を参照する。

2026-10-10のCloudflare管理画面で、Workersの無料プラン（$0）が現在のプランであることを確認した。無料枠の超過による失敗とサービス側の条件変更は継続稼働の制約になる。

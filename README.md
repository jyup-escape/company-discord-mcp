# Company Discord MCP

**1つのDiscord Botを社員全員で共有し、各社員が自分のDiscordアカウントで認証するMCPサーバーです。** Codex、Claude Code、Claudeのリモートコネクター向けに、Streamable HTTPとOAuth認証を実装しています。社員にBotトークンを配布する必要はありません。

## 構成

```text
社員AのCodex ────── OAuth: 社員A ──┐
社員BのClaude Code ─ OAuth: 社員B ──┼─ HTTPS /mcp ─ 共有Bot 1つ ─ 会社Discord
社員CのClaude ───── OAuth: 社員C ──┘                  │
                                   本人とBotの両方の権限を確認
```

管理者がサーバーを1台起動し、全社員が同じ `/mcp` URLを登録します。初回接続時のDiscordログインで社員登録が完了します。社員数の固定上限はありませんが、Discord APIのレート制限とホストの処理能力に従います。

## できること

| ツール | 操作 |
| --- | --- |
| `discord_whoami` | ログインした社員・会社サーバー・接続権限を確認 |
| `discord_list_channels` | 本人とBotが両方とも閲覧できるチャンネル一覧 |
| `discord_read_messages` | メッセージ閲覧。1回最大50件、過去へのページ送り |
| `discord_search_messages` | 指定チャンネルの直近最大500件から部分一致検索。最大20件返却、続きから検索可能 |
| `discord_send_message` | Botから投稿。実行社員のDiscord ID付き。メンション通知を抑止 |

対象は通常のテキストチャンネルとアナウンスチャンネルです。DM、スレッド、フォーラム、音声チャンネル内チャット、添付のアップロード、編集・削除、サーバー管理は含みません。検索は本文が対象で、全履歴の全文検索や添付ファイルの中身の検索ではありません。

## 管理者の初期設定

Windowsでは`管理者セットアップ.cmd`を開くと、トークンを表示しない対話入力で`.env`を設定できます。設定後はBotの認証・会社サーバー参加・Intent・ロールを自動確認します。CLIでは`npm run configure`、接続診断だけなら`npm run doctor`です。既存の暗号鍵と入力済みの値は保持します。

設定後は`MCPサーバー起動.cmd`から検証・ビルド・起動できます。この起動方法ではPCを起動したまま、ウィンドウを開いておく必要があります。常時運用にはサーバー上のDocker構成を利用してください。

### 1. DiscordアプリとBotを1つ作る

1. [Discord Developer Portal](https://discord.com/developers/applications)でアプリを作成します。
2. **General Information → Application ID**を控えます。
3. **OAuth2 → Client Secret**を取得します。
4. **Bot → Token**を取得します。これは管理者のサーバーだけに保存します。
5. **Bot → Privileged Gateway Intents → Message Content Intent**を有効にします。本文取得にはこの設定が必要です。必要な承認についてはDiscord側の案内に従ってください。
6. OAuth2 URL Generatorの`bot`スコープで、**View Channels / Read Message History / Send Messages**だけを指定し、会社サーバーに招待します。Administrator権限は必要ありません。
7. Discordの開発者モードを有効にし、会社サーバーのIDをコピーします。必要なら社員ロールと対象チャンネルのIDもコピーします。

この実装はREST APIを使い、Gatewayへの常時接続はしません。Discord上ではBotがオフライン表示でもAPIで動作します。社員の個人トークンやユーザーアカウントのBot化は使用しません。

### 2. 設定ファイルを用意する

Node.js 24以上が必要です。このフォルダーで実行します。

```powershell
npm ci
npm run setup
```

生成された`.env`を編集します。`DATABASE_KEY`は自動生成されます。

| 設定 | 内容 |
| --- | --- |
| `DISCORD_CLIENT_ID` | Application ID |
| `DISCORD_CLIENT_SECRET` | OAuth2 Client Secret |
| `DISCORD_BOT_TOKEN` | 共有Botのトークン |
| `DISCORD_GUILD_ID` | 会社サーバーのID |
| `PUBLIC_URL` | サーバーの公開元URL。例: `https://discord-mcp.example.com`。末尾に`/mcp`を付けない |
| `EMPLOYEE_ROLE_IDS` | 利用できる社員ロールID。複数はカンマ区切り、どれか1つで許可。空欄はサーバー参加者全員 |
| `ALLOWED_CHANNEL_IDS` | 任意の対象チャンネル制限。空欄はDiscord権限で判断 |
| `ENABLE_SEND` | `false`なら投稿機能を無効化 |

会社サーバーに顧客・外注・ゲストも参加している場合は、`EMPLOYEE_ROLE_IDS`に社員だけが持つロールを指定してください。

Discordアプリの **OAuth2 → Redirects** に、次を追加します。

```text
https://discord-mcp.example.com/oauth/discord/callback
```

ローカル開発では`PUBLIC_URL=http://localhost:3000`とし、Discordにも`http://localhost:3000/oauth/discord/callback`を登録します。Discordへのコールバックと、Codex/Claudeへのコールバックは別です。`.env`の`OAUTH_REDIRECT_URIS`は後者の許可リストです。

### 3. 起動する

ローカル確認:

```powershell
npm run build
npm start
```

`http://localhost:3000/healthz`が`{"status":"ok"}`を返します。これはプロセスの稼働確認で、Discord認証情報の正しさは社員ログインとツール実行で確認します。

Dockerで起動する場合:

```sh
docker compose up -d --build
```

会社で共有する場合は、常時稼働するホストとHTTPSの公開URLが必要です。ClaudeのリモートコネクターはAnthropic側から接続するため、その環境から到達できるURLにしてください。

DNSをホストに向け、`.env`の`PUBLIC_URL=https://discord-mcp.example.com`と`MCP_DOMAIN=discord-mcp.example.com`を設定すれば、同梱のCaddy構成でHTTPSを提供できます。ホストの80/443番ポートを利用します。

```sh
docker compose -f compose.yaml -f compose.https.yaml up -d --build
```

HTTPS構成では専用Dockerサブネット`172.30.42.0/24`を使用します。既存ネットワークと重複する場合は`compose.https.yaml`のサブネット・固定IP・`TRUST_PROXY`を一緒に変更してください。既存リバースプロキシを使う場合は通常のCompose構成を使い、外部からのHostを維持し、`/mcp`とOAuth関連パスをすべて転送してください。`TRUST_PROXY`にはそのプロキシのIP/CIDRだけを指定します。

## 社員の登録

### ファイルを手動ダウンロードせずに登録する

社員向けの登録CLIをGitHub Releaseに配布すると、社員は次の1行で取得・登録できます。Node.js 24以上とCodexが必要です。WindowsではCodexアプリ付属のCLIを自動で探します。Mac/Linuxでは`codex`をPATHに登録するか、`CODEX_CLI_PATH`で指定します。

```sh
npx --yes https://github.com/jyup-escape/company-discord-mcp/releases/latest/download/company-discord-setup.tgz --url https://YOUR-HOST/mcp
```

`YOUR-HOST`は実際の共有MCPサーバーに置き換えます。`npx`が登録CLIを自動取得し、必要な場合だけDiscordの認証画面を開きます。接続を確認したらCodexを終了して開き直し、新しいチャットで利用します。`--check`を追加すると設定変更なしで接続確認だけを行います。MCPサーバーは管理者が引き続き運用します。

配布手順とGitHub Actionsの設定は[CLI配布手順](docs/setup-release.md)を参照してください。非公開リポジトリのReleaseには匿名でアクセスできないため、このコマンドで配布するには社員が取得できる公開先が必要です。

公開URLで稼働した後に`npm run employees`を実行すると、実際のURL入りの`employee-kit`フォルダーを生成します。Codex/Claude Code用のWindows登録ファイル、Mac/Linuxスクリプト、設定例、日本語手順が含まれます。BotトークンやClient Secretは含めません。公開URLの接続確認に成功した場合だけ生成するため、未稼働のURLを社員へ配ることを防ぎます。

社員に配布するのはこのフォルダーだけです。`.env`やDB、プロジェクト全体は配布しないでください。社員向けの詳細説明は[社員向け手順](docs/employee-guide.md)を参照してください。

社員ごとのサーバー構築・Bot作成・APIキー配布は不要です。以下のURLは実際の公開URLに置き換えます。

### Codex

```sh
codex mcp add company-discord --url https://discord-mcp.example.com/mcp
codex mcp login company-discord
```

ブラウザーが開いたら、接続先を確認して同意し、会社サーバーに参加している自分のDiscordアカウントでログインします。CLIが追加時にログインまで完了した場合、2行目は不要です。

設定ファイルから追加する場合:

```toml
[mcp_servers.company-discord]
url = "https://discord-mcp.example.com/mcp"
```

設定後に`codex mcp login company-discord`で認証します。確認コマンドは`codex mcp list`です。

### Claude Code

```sh
claude mcp add --transport http --scope user company-discord https://discord-mcp.example.com/mcp
```

Claude Code内で`/mcp`を開き、`company-discord`を選んで認証します。

### Claude / Claude Desktopのリモートコネクター

設定のコネクターからカスタムコネクターを追加し、URLに`https://discord-mcp.example.com/mcp`を指定してDiscordで認証します。組織の設定によっては管理者が先にコネクターを追加する必要があります。各社員は自分のアカウントで接続してください。

既定では`https://claude.ai/api/mcp/auth_callback`と`https://claude.com/api/mcp/auth_callback`を許可しています。実際のクライアントが別のHTTPS callbackを使用する場合は、管理者が公式の接続先を確認し、完全なURLを`OAUTH_REDIRECT_URIS`に追加します。ネイティブアプリのHTTP loopback callbackは別途許可しており、可変ポートに対応しています。

接続後の依頼例:

- 「Discordのチャンネル一覧を見せて」
- 「開発チャンネルの最新20件をまとめて」
- 「開発チャンネルの直近500件から『リリース』を検索して」
- 「開発チャンネルに『本日のデプロイが完了しました』と投稿して」

## 権限と運用

- **社員の本人確認:** Discord OAuthでIDを確認し、会社サーバーの参加状態と指定ロールをチェックします。申請中の参加者とBotアカウントは登録できません。
- **毎回の検証:** MCPリクエスト・ツール操作時に現在の社員ロールとチャンネル権限を確認します。Botが閲覧できても社員本人が閲覧できなければ取得を拒否します。
- **投稿:** Bot名義で送信し、本文先頭に社員Discord IDを記録します。タイムアウト中の社員からの投稿を拒否し、チャンネルの低速モードをMCP内で適用します。通常のDiscordアプリからの投稿との低速モード共有は行いません。
- **トークン:** MCP用アクセストークンは最大1時間、接続は最大30日。リフレッシュ時にトークンを交換し、再利用を検知すると接続全体を失効させます。30日後は再ログインします。
- **保存:** クライアント認証情報・ユーザー・認可情報はSQLite内でAES-256-GCM暗号化。MCPトークンの照合にはハッシュを使い、Discordユーザートークンやメッセージ本文をDBに保存しません。監査ログは日時・社員ID・操作名・チャンネルID・結果・投稿IDを平文で90日保管します。
- **DB保護:** `.env`とDBファイル/ボリュームはサーバー管理者だけがアクセスできるようにしてください。`DATABASE_KEY`はDBと別に安全にバックアップし、同じDBを使う間は変更しないでください。SQLiteのバックアップはプロセス停止中に取得するか、SQLite対応バックアップを使用してください。
- **構成:** 単一プロセス・単一ホスト向けです。複数レプリカや社員数に対する負荷試験は未実施です。Discord APIのレート制限はRESTライブラリで処理し、MCPは社員ごとに毎分60リクエストに制限します。
- **既存の取得結果:** 権限を取り消しても、すでに接続アプリに渡った会話履歴までは消去できません。

管理者コマンド（サーバーホスト上のみ）:

```sh
npm run admin -- users
npm run admin -- audit
npm run admin -- disable 123456789012345678
npm run admin -- enable 123456789012345678
npm run admin -- revoke 123456789012345678
```

`disable`はその社員を利用停止にし、既存の接続も失効させます。`enable`後は再ログインが必要です。`revoke`は現在の接続だけを失効させ、再ログインは許可します。未登録の社員IDも事前に利用停止できます。

Dockerでは`docker compose exec mcp node dist/admin.js users`のように実行します。HTTPS構成を使っている場合は起動時と同じ`-f compose.yaml -f compose.https.yaml`を指定します。

## 開発・確認

```sh
npm run check
npm test
npm run build
```

テストではDiscord APIをモックし、実HTTPでOAuth認証、PKCE、トークン更新・失効、ブラウザーとの紐付け、複数社員の権限分離を検証しています。公式MCP SDKクライアントからの接続・ツール取得・閲覧・投稿もテストします。実際の会社サーバー、Codex、Claude、Docker/HTTPSの動作は環境設定後に確認してください。

本番公開前には社員アカウントで`discord_whoami`を実行し、見えるチャンネル/見えないチャンネル、閲覧、テスト用チャンネルへの投稿を確認します。最後に社員ロールを外した状態でアクセスできなくなることを確認してください。

### よくある問題

| 症状 | 確認事項 |
| --- | --- |
| ログイン後に拒否される | ログインしたDiscordアカウント、会社サーバー参加、社員ロール、参加手続きの完了、管理者による停止状態 |
| 本文が空・検索に出ない | Message Content Intent、検索対象が直近の限定範囲であること |
| チャンネルが一覧に出ない | 本人とBot両方のView Channels / Read Message History、チャンネルallowlist、対応チャンネル種別 |
| 投稿できない | 本人とBot両方のSend Messages、タイムアウト、低速モード、`ENABLE_SEND`とOAuthの書き込み権限 |
| OAuth callbackが拒否される | Discord PortalのRedirectsと`PUBLIC_URL`の一致、クライアントcallbackの許可リスト |
| `invalid_origin` | ブラウザーから直接接続するクライアントの正確なOriginを`ALLOWED_ORIGINS`に追加 |
| `invalid_host` | リバースプロキシでHostを維持しているか、公開URLが正しいか |
| 再ログインを求められる | 30日の期限、管理者の失効操作、更新トークンの再利用。1つの社員用トークンを複数人・複数クライアントで共有しない |

## このPCからの暫定公開

MCPの起動時に共通BotもDiscord Gatewayへ接続し、オンライン表示になります。`/healthz`の`bot`が`online`ならDiscordへの接続が完了しています。通信切断時の再接続はライブラリで処理し、初回ログイン失敗時は30秒後に再試行します。

`暫定公開を起動.cmd`でWindowsタスク`Akagumi-Discord-MCP-Temporary`を手動起動します。ターミナルを閉じても、Windowsにログインしている間は動作します。PCのスリープ・ログアウト・シャットダウン中は利用できません。起動済みのタスクを再度起動してもURLは変えません。

現在の公開URLは次のコマンドで確認できます。

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/share.ps1 status
```

停止には`暫定公開を停止.cmd`を使います。タスクは自動起動しません。公開を起動し直すとCloudflareのURLが変わるため、次の更新が必要です。

1. 状態表示の`callbackUrl`をDiscord Developer PortalのOAuth2 Redirectsへ保存します。古い暫定URLの項目を置き換えます。
2. `npm run employees`で社員向けファイルを作り直し、新しい接続URLを配布します。
3. Codex・Claudeの接続先URLを変更し、各社員が再ログインします。

Botトークン・Client Secret・DBの暗号鍵は公開の再起動で変更しません。Cloudflare Quick Tunnelは試用向けで稼働保証がありません。継続運用には固定ドメインと常時稼働ホストへ移行してください。

## 参照

- [MCP TypeScript SDK](https://ts.sdk.modelcontextprotocol.io/server)
- [Discord OAuth2](https://github.com/discord/discord-api-docs/blob/main/developers/topics/oauth2.mdx)
- [Discord Permissions](https://github.com/discord/discord-api-docs/blob/main/developers/topics/permissions.mdx)
- [Discord Message Resource / Message Content Intent](https://github.com/discord/discord-api-docs/blob/main/developers/resources/message.mdx)
- [OpenAI公式: CodexへのMCP追加例](https://developers.openai.com/learn/docs-mcp)（`login`の引数はローカルCodex CLIの`--help`でも確認）
- [Claude Code MCP](https://code.claude.com/docs/en/mcp)
- [Claudeカスタムコネクター](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)

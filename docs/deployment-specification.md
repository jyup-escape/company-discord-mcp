# 設置仕様と導入確認

確認日: 2026-10-10（日本時間）
対象: https://github.com/jyup-escape/company-discord-mcp
取得時の版: 41ba93da8f9ac0ad4da24233ebc5a7ef52841bd6

## 現在の状態

READMEの手順に従って取得、`npm ci`、`npm run setup`、型検査、試験、ビルドを実施した。`.env`と32バイトの保存用暗号鍵を生成した。DiscordのアプリID、Client Secret、Bot Token、サーバーIDは入力・Cloudflare反映済み。公開先の稼働確認はHTTP 200を返す。未認証のMCP要求は401で拒否する。公開URLは https://company-discord-mcp.desudesu2387.workers.dev 。パソコンを停止しても公開先はCloudflare側で提供される。試験は模擬Discord APIを使用するため、実際のDiscord接続成功を意味しない。

## ファイルの関係

| ファイル | 役割と接続先 |
| --- | --- |
| `src/index.ts` | 設定を読み、Store、Express、Discord Gatewayを起動する。終了時にHTTPとDBを閉じる |
| `src/config.ts` | 環境変数、公開URL、ID、暗号鍵、許可する認証戻り先を検査する |
| `src/app.ts` | HTTP経路、認証、Host・Originの検査、要求回数制限を組み合わせる |
| `src/auth.ts` | Discordログイン、MCPのOAuth、PKCE、認証コードの消費、更新トークンの交換と失効を処理する |
| `src/store.ts` | Node.jsのSQLiteへ認証状態と操作記録を保存する。認証状態はAES-256-GCMで暗号化する |
| `src/discord.ts` | Discord REST APIを呼び、本人とBotの権限を確認する |
| `src/permissions.ts` | Discordのロールとチャンネル設定から権限を計算する |
| `src/mcp.ts` | 閲覧、検索、投稿等のMCPツールを定義する |
| `src/gateway.ts` | Discordへ常時接続し、Botのオンライン表示と接続状態を管理する |
| `src/doctor.ts` | 実際のBot認証、所属、Message Content Intent、閲覧権限を診断する |
| `scripts/setup.mjs` | `.env`と暗号鍵を生成する。既存設定は上書きしない |
| `compose.yaml` | Node.jsサーバーの再起動とSQLiteの保存領域を設定する |
| `compose.https.yaml` / `Caddyfile` | 専用ホストでHTTPSを提供する |

READMEにはGatewayへの常時接続をしないとの説明があるが、取得した実装の`src/index.ts`は`connectBot`を呼ぶ。設置判断では現在のコードを基準とする。

## 公開するHTTP経路

| 経路 | 内容 |
| --- | --- |
| `GET /` | MCPの接続URLを返す |
| `GET /healthz` | HTTP処理の稼働とBotの接続状態を返す。Discordの権限やOAuth全体の検証にはならない |
| `/.well-known/oauth-authorization-server` | MCP OAuthの認証先情報 |
| `/.well-known/oauth-protected-resource/mcp` | MCPの保護対象情報 |
| `/register` | 許可した戻り先を持つMCP接続アプリを登録する |
| `/authorize` / `/token` / `/revoke` | OAuth認可、トークン交換、失効。SDKが提供する経路 |
| `GET, POST /oauth/discord/start` | 同意画面からDiscord認証を開始する |
| `GET /oauth/discord/callback` | Discord認証結果を受け取る |
| `POST /mcp` | Bearer認証付きのMCP要求。認証後はPOST以外を405で拒否する |

独自の`/command`実行基盤はこのMCP設置の対象に含めない。

## 設置先と変更の影響範囲

現行版をそのまま動かすにはNode.js 24以上、持続するSQLite保存領域、HTTPS、実行中の計算機が必要になる。Cloudflare Tunnelは既存の計算機へ到達する経路を提供するものであり、計算機自体を代替しない。

Cloudflare Workers向けに以下の対応を実施した。

1. SQLiteの保存処理をSQLite形式のDurable Objectsへ対応させた。期限管理、暗号化、認証コードの一回使用、更新トークン再使用時の失効、処理の原子性を維持する。
2. HTTPの入口をWorkers用へ追加した。ExpressはCloudflareのNode.js HTTP処理を通して実行する。
3. Gatewayへの常時接続をWorkers経路では起動しない。REST用の定期処理も停止し、無通信時の待機を妨げない。MCPのREST機能とBotのオンライン表示を区別する。
4. 要求回数制限の情報は暗号化してDurable Objectsへ保存し、再起動後にも回数を保持する。
5. `wrangler`設定と公開手順を追加した。既存のOAuth・権限分離試験に加え、Workers実行環境で登録、同意、認証券の再使用拒否、未認証拒否、保存後の再起動を検証した。Discordへの実ログインはアプリ作成後に確認する。

`src/auth.ts`、`src/discord.ts`、`src/app.ts`は具体的なStore型に依存するため、保存処理の置換はこれらの型と試験にも影響する。認証状態をメモリーのみへ変更する方法は採用しない。

## 無料枠の条件

Cloudflare Workers Freeには一日100,000要求、HTTP要求ごとにCPU時間10msの制限がある。SQLite形式のDurable Objectsは無料枠で利用でき、要求100,000/日、実行時間13,000 GB-s/日、行読出し500万/日、行書込み100,000/日、保存5GBの枠がある。上限超過時は処理が失敗する。無料枠内での利用を前提とし、有料プランへ変更しない。恒久的な無料提供や無停止を保証するものではない。

Renderの無料サービスは無通信15分で停止し、無料サービスへ永続ディスクを付けられないため、現行のSQLite構成の設置先には適さない。OracleのAlways Free計算機は既存構成を動かせる候補だが、空き容量、本人確認、休止状態の計算機の回収条件を確認する必要がある。

公式資料:
- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/durable-objects/platform/pricing/
- https://developers.cloudflare.com/workers/runtime-apis/nodejs/http/
- https://developers.cloudflare.com/workers/configuration/compatibility-flags/
- https://render.com/docs/free
- https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm

## 公開前に必要な入力と確認

- Cloudflare: `wrangler login`で再認証済み。公開コードと保存用暗号鍵を反映済み。
- Discord: アプリID、Client Secret、Bot Token、会社サーバーIDは入力と反映を確認済み。値はGitや仕様書へ記録しない。
- Discord Developer Portal: Message Content Intentを有効にし、Botへ閲覧・履歴読出し・投稿の権限を設定する。
- 公開URLが決まった後、`PUBLIC_URL`とDiscord OAuth2 Redirectsを一致させる。戻り先は公開URLに`/oauth/discord/callback`を付けた値。
- ゲストがいるサーバーでは社員ロールを確認し、`EMPLOYEE_ROLE_IDS`へ設定する。
- 公開後、HTTPS、OAuth情報、未認証拒否、社員ログイン、チャンネル一覧、閲覧を確認する。投稿の実確認は送信先と本文の指示を受けて実施する。

## 検証結果

| 検証 | 結果 |
| --- | --- |
| `npm ci` | 成功。導入時の監査は脆弱性0件 |
| `npm run check` | 成功 |
| `npm test` | 34件成功（保存処理と要求回数の保持試験を追加） |
| `npm run test:setup-cli` | 8件成功 |
| `npm run build` | 成功 |
| `npm run setup` | `.env`と暗号鍵を生成 |
| `wrangler whoami` | 再認証後に成功 |
| `npm run check:workers` | 成功 |
| Workers実行環境 | 登録、同意、認証券の再使用拒否、Origin検査、再起動後の登録保持を確認 |
| Discord実接続 | Bot認証、アプリ一致、サーバー参加、Intent、16チャンネルの履歴閲覧権限を確認。Client Secretの組合せも確認 |
| 外部公開 | 稼働確認200、認証情報200、未認証MCP401、社員のOAuthログイン、本人情報、チャンネル一覧、投稿、投稿後の履歴読出しを確認 |

## Cloudflare用の追加ファイルと運用

| ファイル | 役割 |
| --- | --- |
| `src/storage.ts` | 暗号化、保存操作、期限管理の共通実装。Node.js用のSQLite依存を分離 |
| `workers/database.ts` | Durable ObjectsのSQLiteと同期的な原子処理へ対応 |
| `workers/rate-limit.ts` | 要求元の識別値をハッシュ化し、回数を暗号化して保存 |
| `workers/index.ts` | 公開入口、設定未完了の拒否、転送ヘッダーの除去、単一の保存対象への転送、Expressの起動 |
| `wrangler.jsonc` | 公開名、公開元URL、SQLite形式のDurable Objects、初回移行 |
| `tsconfig.workers.json` | Cloudflareの型の検査 |
| `scripts/deploy-cloudflare.mjs` | 公開処理と秘密情報の反映。秘密情報は標準入力を通じてWranglerに渡す |
| `test/workers-store.test.ts` | 保存、消費、取消し、暗号化、暗号鍵不一致、要求回数の保持を検証 |

設定後は `npm run doctor` と `npm run deploy:cloudflare` を実行する。`--allow-incomplete` は公開先を先に用意する用途であり、Discord設定が揃わない状態では503を返す。認証の戻り先は https://company-discord-mcp.desudesu2387.workers.dev/oauth/discord/callback 。社員が登録するURLは https://company-discord-mcp.desudesu2387.workers.dev/mcp 。

Cloudflare経路ではBotはDiscord上でオフライン表示になる。MCPの閲覧・検索・投稿はREST APIで実行する。Node.jsの `npm run admin` はローカルSQLiteを対象とするため、Cloudflare側の社員状態の変更には使用できない。既存SQLiteの認証状態をDurable Objectsへ自動移行する処理は含まない。

暗号鍵は最初に作成した値を保持する。鍵を変更すると既存の認証状態を復号できない。稼働処理は要求に応じて実行し、未使用時の常時実行や外部からの定期呼出しは設定していない。期限切れの情報と90日経過した操作記録は、その後の要求時に一時間間隔で削除する。

2026-10-10のCloudflare管理画面で、Workersの無料プラン（$0）が現在のプランであることを確認した。無料枠の超過による失敗とサービス側の条件変更は継続稼働の制約になる。

## Discord設定反映後の状態

2026-10-10、Discordの設定4項目をCloudflareへ反映した。Bot認証、アプリ一致、Message Content Intent、対象サーバーへのBot参加、Botが16チャンネルの履歴を取得できる権限を確認した。Client SecretとApplication IDはDiscordの認証要求で一致を確認し、診断用に発行した一時認証は失効した。

Discordアプリの認証戻り先 https://company-discord-mcp.desudesu2387.workers.dev/oauth/discord/callback の登録をAPIで確認した。社員本人が認証画面を操作し、公開先でのOAuthログインとログイン後のMCP操作を確認した。

社員ロールと対象チャンネルの制限は空欄。現在の対象はDiscordサーバー参加者全員であり、閲覧・投稿には本人とBotの双方のDiscord権限を適用する。社員向け配布ファイルを生成し、「アカウント共有」に導入案内を投稿した。

## HTTP処理の再生成時の修正

2026-10-10、無通信後のMCP接続で固定の待受番号が再登録され、`EADDRINUSE`により500となる事象を確認した。影響範囲はWorkersのHTTP入口であり、認証状態の保存形式とNode.js/Dockerの入口には変更を加えていない。

`workers/http.ts`で要求ごとに自動割当ての待受番号を用い、処理後にHTTPサーバーを閉じる。Durable Objectsの再生成に伴って古いHTTP登録が残る状態を防ぐ。並行要求と再生成相当の呼出し、失敗時の待受登録解除を検証する試験を追加し、サーバー試験36件とWorkers型検査が通過した。Cloudflareへ反映した。

本人による認証後、`discord_whoami`、`discord_list_channels`、`discord_send_message`、`discord_read_messages`を公開先のMCP経由で実行した。「アカウント共有」（1553000096961142814）へ社員向け導入案内を投稿し、履歴に同じ投稿IDが含まれることを確認した。投稿用の一時認証は処理終了時に失効した（HTTP 200）。

投稿URL: https://discord.com/channels/1552927906638995466/1553000096961142814/1558366668387000340


## フォーラム読取りの追加（2026-10-10）

変更対象は `src/discord.ts`（Discord APIと権限確認）、`src/mcp.ts`（ツール公開）、`test/helpers.ts`、`test/service.test.ts`、`test/auth.test.ts`、README。認証経路、暗号化の保存形式、Cloudflareの保存対象に変更はない。

### MCP操作

| 操作 | 入力・出力 |
| --- | --- |
| `discord_list_channels` | 従来のチャンネルに加え、閲覧可能なフォーラム（type=15）を返す |
| `discord_list_forum_posts` | `forum_id`、`archived`（既定false）、`limit`（1〜50、既定20）、`before`（保存日時）、`offset`（表示中の一覧の位置）。投稿ID、表題、保存状態、タグID、URL、件数、続きの位置を返す |
| `discord_read_forum_post` | `post_id`、`limit`（1〜50、既定20）、`before`（メッセージID）。投稿情報、最初の本文 `starter`、直近の本文・返信 `messages`、`next_before` を返す。最初の本文が削除済みならstarterはnull |
| `discord_read_messages` / `discord_search_messages` | フォーラムの投稿IDも受け付ける。検索は指定投稿の直近最大500件が対象 |

フォーラム本体のIDではメッセージを取得できない。投稿一覧から投稿IDを選ぶ。表示中と保存済みは別の要求で取得する。表示中はID降順で `next_offset`、保存済みは保存日時降順で `next_before` を用いる。表示中の一覧が取得間に変化した場合、位置の移動による重複・欠落が生じる可能性がある。

### Discord APIと権限

- `GET /guilds/{guild_id}/threads/active`：表示中の投稿を取得し、対象フォーラムの公開スレッドへ限定する。他の親、他のサーバー、非公開スレッドを返さない。
- `GET /channels/{forum_id}/threads/archived/public`：保存済みの公開投稿を保存日時でページ送りする。
- `GET /channels/{post_id}/messages/{post_id}`：最初の本文。404のみ削除済みとして扱い、他の失敗を隠さない。
- `GET /channels/{post_id}/messages`：本文・返信を取得する。

本人の会社参加状態と、本人・Bot双方の親フォーラムのViewChannelおよびReadMessageHistoryを確認する。投稿のサーバーID、親ID、公開スレッド種別を検査する。ALLOWED_CHANNEL_IDSの制限は親フォーラムIDに適用する。スレッド自身の上書き権限を用いて親の拒否を回避する処理はない。フォーラム本体と公開投稿への書込みは拒否する。フォーラム以外のスレッドと非公開スレッドは引き続き拒否する。

参照仕様: [Discordのスレッド仕様](https://github.com/discord/discord-api-docs/blob/main/developers/topics/threads.mdx)、[チャンネルAPI](https://github.com/discord/discord-api-docs/blob/main/developers/resources/channel.mdx)。

### 検証

サーバー試験40件、Node.jsとWorkersの型検査が成功した。読取り専用のOAuth接続から新しいMCPツールを呼び出す試験も実施した。親の権限拒否、Botの権限拒否、対象外の親・サーバー・非公開投稿、許可一覧、本文削除、返信と一覧のページ送り、書込み拒否を検証した。

実際のDiscord APIと変更後の権限確認処理で「アイデア」（1553858110446108822）を取得し、表示中31件・保存済み1件を確認した。表示中の1件について最初の本文と直近メッセージを取得できた。本文内容は仕様書とGitへ保存していない。この実接続確認はローカルの変更後処理で実行しており、公開先の新しいツールへの本人OAuth再接続は実施していない。

Cloudflareへ変更を反映し、公開先の稼働確認がHTTP 200を返すことを確認した。

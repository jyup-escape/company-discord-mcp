# 自鯖のコマンドをGitHub Actionsからポーリングする

## セットアップ済みWindows PCでの使い方

このフォルダーで次を実行すると、コマンドを送信し、Actionsの実行完了を待って
標準出力とエラー出力をそのまま返します。CLIの終了コードもコマンドと同じです。
トークンは `.env.command` から読み取るので、手入力は不要です。

```powershell
node --env-file=.env.command scripts/submit-command.mjs 'echo hello && node --version'
```

通常は結果確認の操作は不要です。Actionsのジョブが起動中なら、待機中は10秒ごとに
コマンドを取得します。さらにコマンドの実行時間と結果取得の時間を待ちます。
ジョブ起動の遅延や切り替え中は、数分以上待つことがあります。
待機は最大20分です。待機がタイムアウトした場合はtimestampが表示されます。
登録済みコマンドはその後も実行される可能性があるため、自動で再送はしません。
表示されたtimestampで状況を確認できます。

```powershell
node --env-file=.env.command scripts/submit-command.mjs --status 1790812800000
```

公開プロセスの操作:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/command-runtime.ps1 status
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/command-runtime.ps1 stop
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/command-runtime.ps1 start
```

Windowsのタスク `Akagumi-Command-Polling` でバックグラウンド実行します。
PCを起動してログインした状態で使います。ログは `data/command-server.log` と
`data/command-tunnel.log`、公開URLは `data/command-runtime.json` に保存します。
Cloudflare Quick TunnelのURLは再起動すると変わります。その場合はGitHubの
`COMMAND_SERVER_URL` Secretを新しいURLに更新してください。
固定URLで常時運用する場合は、以下の専用ドメインの設定を使ってください。

Node.js 24以上。既存のDiscord MCPとは別プロセスで動作します。
自鯖はコマンドを保存し、Actions側が任意のBashコマンドを実行します。
サーバーの `/command` 自体はコマンドを実行しません。

## 1. 自鯖を起動

```sh
npm ci
cp .env.command.example .env.command
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

乱数生成を2回実行し、`.env.command` の `COMMAND_POLL_TOKEN` と
`COMMAND_PUBLISH_TOKEN` に別々の値を設定します。Windowsのコピーは
`Copy-Item .env.command.example .env.command` です。

```sh
node --env-file=.env.command scripts/command-server.mjs
```

初期設定では `127.0.0.1:8787` で待ち受けます。常時運用ではsystemd等で
このプロセスを管理し、Caddy/Nginx等で専用ホスト名のHTTPSを終端して
`127.0.0.1:8787` に転送してください。たとえばCaddyの設定:

```caddy
commands.example.com {
    reverse_proxy 127.0.0.1:8787
}
```

`data/commands.db` とSQLiteの関連ファイルは永続ディスクに置いてください。
DBを消したり古いバックアップに戻すと重複防止の記録も失われます。

## 2. GitHubの設定

Repository Settings → Secrets and variables → Actions:

| 種類 | 名前 | 値 |
| --- | --- | --- |
| Secret | `COMMAND_SERVER_URL` | `https://commands.example.com`（パスなし） |
| Secret | `COMMAND_POLL_TOKEN` | 自鯖に設定した読み取り・実行権限のトークン |
| Variable | `COMMAND_POLL_ENABLED` | `true` |

公開用トークン `COMMAND_PUBLISH_TOKEN` はGitHubに登録せず、管理者側で保管します。
`.github/workflows/poll-command.yml` をデフォルトブランチに置くと、5分ごと
（毎時2、7、12…57分）にジョブを起動し、ジョブ内で10秒ごとのポーリングを5分間続けます。
Actions画面の **Poll repository command → Run workflow**
から手動実行もできます。Variableが未設定ならジョブはスキップします。

## 3. コマンドを登録

Pythonの標準ライブラリだけで送信できます。環境変数に公開URLと管理者トークンを設定して実行:

```python
import json, os, time, urllib.request

payload = {"command": "npm run build", "timestamp": time.time_ns() // 1_000_000}
request = urllib.request.Request(
    os.environ["COMMAND_SERVER_URL"] + "/command",
    data=json.dumps(payload).encode(),
    headers={"Authorization": "Bearer " + os.environ["COMMAND_PUBLISH_TOKEN"],
             "Content-Type": "application/json"},
    method="POST",
)
with urllib.request.urlopen(request, timeout=15) as response:
    print(response.read().decode())
```

POSTの形式は `{"command":"npm run build","timestamp":1790812800000}`。
timestampは正の整数のUnixミリ秒で、全コマンド共通の一意な識別子です。
同じtimestamp・同じcommandの再登録は既存の状態を返します。
同じtimestampでcommandを変更すると409になります。同一ミリ秒に複数登録する
送信者はtimestampが重ならないよう調整してください。

`command` には任意のBashコマンドを指定できます。たとえば:

```json
{"command":"npm run check && npm test && npm run build","timestamp":1790812800000}
```

パイプ、リダイレクト、`;`、`&&`、`$()`、改行を含むスクリプトも使えます。
空文字・空白だけの文字列・NUL文字は拒否します。JSONリクエスト全体の上限は4KBです。
ActionsのUbuntu runnerで、チェックアウトしたリポジトリを作業ディレクトリにして
`/bin/bash --noprofile --norc -o pipefail -c` で実行します。実行できるのはrunner上に
存在する、またはコマンド内でインストールしたプログラムです。自鯖上での実行ではありません。
パイプ途中の失敗は終了コードに反映します。複数コマンドを途中の失敗で止める場合は
`&&` でつなぐか、先頭に `set -e` を指定してください。

登録用トークンを持つ人はrunner上で任意のコマンドを実行できます。
コマンドの子プロセスにはCOMMAND用トークンの環境変数を引き継ぎませんが、
任意コード実行に対する隔離境界ではありません。信頼する管理者だけにトークンを渡してください。

## プロトコルと重複防止

| API | トークン | 動作 |
| --- | --- | --- |
| `GET /command` | POLL | 最も古い未実行コマンド。空なら204 |
| `POST /command` | PUBLISH | コマンドを保存 |
| `POST /command/claim` | POLL | commandとtimestampを照合して実行権を取得。既取得なら409 |
| `POST /command/result` | POLL | command、timestamp、exitCode、stdout、stderr、truncatedを保存 |
| `GET /command/{timestamp}` | PUBLISH | 状態、終了コード、stdout、stderr、truncatedを取得 |

Actionsは1回のポーリングで1件を実行します。コマンドの実行中は次の取得を待ち、
終了後にポーリングを再開します。未実行のコマンドはDBにキューとして残ります。
1つのコマンドが失敗しても、ジョブの残り時間は後続コマンドの取得を続けます。
実行前にSQLiteの条件付きUPDATEで `pending → claimed` を永続化し、並列ポーリングや
Actionsの再実行、サーバー再起動でも同じtimestampの実行権を再発行しません。

**重複しないことを優先するat-most-once方式です。** claim直後にActionsが落ちた場合、
コマンドが実際には実行されなくても `claimed` のまま残ります。失敗やタイムアウトも
自動リトライしません。状態とActionsログで実行結果を確認してから、新しいtimestampで
再登録してください。新しいtimestampを使えば同じコマンドでも再実行されます。
コマンドは最大8分、Actionsジョブ全体は最大16分です。5分のポーリング終了間際に
取得したコマンドも、実行と結果保存まで完了させます。
標準出力とエラー出力はそれぞれ先頭128KiBまで保存します。上限後も出力を読み捨てて
実行を継続し、結果には `truncated` を設定します。結果送信APIのJSON上限は2MiBです。
コマンド登録APIの4KB上限は変わりません。実行結果は自鯖のDBに保存されます。

## 運用上の前提

ポーリング方式でも利用制限やアカウント停止を回避できる保証はありません。
GitHub-hosted runnerは、リポジトリのソフトウェアの開発・テスト・デプロイ・公開に
関係する用途で利用してください。
[GitHub Actionsの追加利用条件](https://docs.github.com/en/site-policy/github-terms/github-terms-for-additional-products-and-features)

scheduleの最短間隔は5分です。10秒間隔はジョブ内のループで実現しています。
[Workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)
scheduleは遅延・欠落があり、デフォルトブランチで動作します。
公開リポジトリでは60日間活動がないと定期実行が無効になることがあります。
厳密な時刻や即時実行が必要な処理には適しません。
10秒ごとの確認が常時途切れず続く保証はありません。ジョブの起動・依存関係の準備・
ジョブ切り替え・長いコマンドの実行中には空白時間があります。
[scheduleの仕様](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)

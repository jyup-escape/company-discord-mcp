# 社員向けCLIの自動配布

GitHub Actionsがタグを検知して、社員向けセットアップCLIをGitHub Releaseに配布します。社員はReleaseのURLを`npx`に渡すだけで、自動取得して実行できます。npmへの公開やnpmアカウントの設定は不要です。

## 社員が実行するコマンド

Node.js 24以上とCodexをインストールしたPCで実行します。

```sh
npx --yes https://github.com/jyup-escape/company-discord-mcp/releases/latest/download/company-discord-setup.tgz --url https://YOUR-HOST/mcp
```

`YOUR-HOST`を管理者が実際の値に置き換えて共有してください。必要な場合だけ社員本人がブラウザーでDiscord認証を行います。成功後にCodexを終了して開き直し、新しいチャットで利用します。

WindowsではCodexアプリに付属するCLIを自動検出します。Mac/Linuxでは`codex`がPATHに必要です。任意のCLIパスは`CODEX_CLI_PATH`で指定できます。

登録と接続の確認だけを行う場合は末尾に`--check`を付けます。このモードでは登録やログインを実行しません。

## 管理者の公開手順

1. このプロジェクトをGitHubリポジトリに配置します。この作業フォルダーにGit管理情報がない場合は、先にGitHub側のリポジトリを用意してください。
2. `packages/company-discord-setup/package.json`のバージョンを設定します。初回は`0.1.0`です。
3. 次のタグをpushします。タグの番号はセットアップCLIのバージョンと一致させてください。

```sh
git tag setup-v0.1.0
git push origin setup-v0.1.0
```

`.github/workflows/release-setup.yml`がWindows/Linuxで検証し、`company-discord-setup.tgz`をReleaseに添付します。必要な公開権限はジョブの`GITHUB_TOKEN`で付与します。Discordの認証情報はActionsに渡しません。

リポジトリが公開されていればRelease URLを匿名で取得できます。非公開リポジトリのReleaseをそのまま社員へ配布すると、通常の`npx`では取得できません。社内で取得できる配布先か、公開可能なセットアップ専用リポジトリを使ってください。

## ローカルで配布物を確認する

```sh
npm run test:setup-cli
npm run pack:setup
npx --yes ./setup-artifacts/company-discord-setup.tgz --help
```

パッケージに含まれるのはCLI、Windows用の登録スクリプト、package.json、READMEだけです。配布物の作成時にファイル一覧を検証します。管理者用の`.env`やDB、社員の認証情報は含まれません。

`npx`は実行時にCLIを取得します。公開先の最新版を指定して再実行すれば更新版を取得できますが、PCに常駐して自動更新する仕組みではありません。共有MCPサーバーは引き続き管理者が起動・公開する必要があります。

バージョンを固定したい場合は、`releases/latest/download`を`releases/download/setup-v0.1.0`などに置き換えます。

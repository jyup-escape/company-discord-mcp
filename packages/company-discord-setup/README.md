# Company Discord Setup

Register the company's shared Discord MCP server in Codex. Node.js 24+ and
Codex must already be installed. On Windows, the CLI bundled with the Codex
app is detected automatically; on macOS/Linux, `codex` must be on PATH or
specified by `CODEX_CLI_PATH`.

```sh
npx --yes https://github.com/jyup-escape/company-discord-mcp/releases/latest/download/company-discord-setup.tgz --url https://YOUR-HOST/mcp
```

Replace YOUR-HOST with the endpoint host supplied by your company.
The package is fetched automatically. Complete Discord authentication in the
browser when prompted, then restart Codex and open a new chat.

Add `--check` to verify an existing registration without changing it.
The package contains the registration CLI only. The shared MCP server must
already be running at the specified URL.

For a private GitHub repository, anonymous downloads from its Releases will
not work. Use an employee-accessible package registry or distribution location.

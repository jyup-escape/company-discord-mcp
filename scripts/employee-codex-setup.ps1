param([switch]$CheckOnly, [string]$Endpoint = '__MCP_ENDPOINT__')
$ErrorActionPreference = 'Stop'
$endpoint = $Endpoint

function Find-Codex {
  if ($env:CODEX_CLI_PATH -and (Test-Path -LiteralPath $env:CODEX_CLI_PATH)) { return $env:CODEX_CLI_PATH }
  $bundled = Join-Path $env:LOCALAPPDATA 'OpenAI\Codex\bin'
  if (Test-Path -LiteralPath $bundled) {
    $binary = Get-ChildItem -LiteralPath $bundled -Directory | Sort-Object LastWriteTime -Descending | ForEach-Object {
      $candidate = Join-Path $_.FullName 'codex.exe'
      if (Test-Path -LiteralPath $candidate) { Get-Item -LiteralPath $candidate }
    } | Select-Object -First 1
    if ($binary) { return $binary.FullName }
  }
  $command = Get-Command codex -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  throw 'Codexが見つかりません。Codexアプリをインストールして一度起動してから、もう一度このファイルを開いてください。'
}

function Get-DiscordTools([string]$cli) {
  # Use Codex's own credentials and MCP client; this does not start an AI conversation.
  $info = New-Object System.Diagnostics.ProcessStartInfo
  if ([System.IO.Path]::GetExtension($cli) -in @('.cmd','.bat')) {
    $info.FileName = $env:ComSpec
    $info.Arguments = '/d /s /c ""' + $cli + '" app-server --stdio"'
  } elseif ([System.IO.Path]::GetExtension($cli) -eq '.ps1') {
    $info.FileName = (Get-Command powershell).Source
    $info.Arguments = '-NoProfile -ExecutionPolicy Bypass -File "' + $cli + '" app-server --stdio'
  } else {
    $info.FileName = $cli
    $info.Arguments = 'app-server --stdio'
  }
  $info.UseShellExecute = $false
  $info.CreateNoWindow = $true
  $info.RedirectStandardInput = $true
  $info.RedirectStandardOutput = $true
  $info.RedirectStandardError = $true
  $process = New-Object System.Diagnostics.Process
  $process.StartInfo = $info
  try {
    if (-not $process.Start()) { throw 'Codexの接続確認を開始できません。' }
    $errorDrain = $process.StandardError.ReadToEndAsync()
    $requests = @(
      @{id=1;method='initialize';params=@{clientInfo=@{name='company_discord_setup';version='1'};capabilities=@{experimentalApi=$true}}},
      @{method='initialized';params=@{}},
      @{id=2;method='mcpServerStatus/list';params=@{serverName='company-discord';detail='toolsAndAuthOnly'}}
    )
    foreach ($request in $requests) { $process.StandardInput.WriteLine(($request | ConvertTo-Json -Depth 10 -Compress)) }
    $deadline = [DateTime]::UtcNow.AddSeconds(35)
    while ([DateTime]::UtcNow -lt $deadline) {
      $line = $process.StandardOutput.ReadLineAsync()
      $remaining = [Math]::Max(1,[int]($deadline - [DateTime]::UtcNow).TotalMilliseconds)
      if (-not $line.Wait($remaining) -or $null -eq $line.Result) { break }
      try { $response = $line.Result | ConvertFrom-Json } catch { continue }
      if ($response.id -eq 2) {
        if ($response.error) { return $false }
        $server = $response.result.data | Where-Object name -eq 'company-discord'
        return ($server -and $server.tools -and ($server.tools.PSObject.Properties.Name -contains 'discord_whoami'))
      }
    }
    return $false
  } finally {
    if ($process.Id -and -not $process.HasExited) { $process.Kill() }
    $process.Dispose()
  }
}

try {
  $cli = Find-Codex
  Write-Host '会社Discordへの接続を確認しています...'
  $origin = ([Uri]$endpoint).GetLeftPart([System.UriPartial]::Authority)
  try { $health = Invoke-RestMethod -Uri ($origin + '/healthz') -TimeoutSec 10 }
  catch { throw '会社Discordの接続先に届きません。管理者PCの起動状態と、配布されたURLが最新か確認してください。' }
  if ($health.status -ne 'ok') { throw '管理者にサーバーの状態を確認してもらってください。' }
  # An unregistered server is an expected result, including on Windows PowerShell 5.
  $previousPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $currentText = & $cli mcp get company-discord --json 2>$null
    $exists = $LASTEXITCODE -eq 0
  } finally { $ErrorActionPreference = $previousPreference }
  $current = if ($exists) { ($currentText -join "`n") | ConvertFrom-Json } else { $null }
  if ($CheckOnly) {
    if (-not $exists -or $current.transport.url -ne $endpoint -or -not (Get-DiscordTools $cli)) { throw 'Codexの登録・ログインが未完了です。通常モードでセットアップを実行してください。' }
  } elseif (-not $exists -or $current.transport.url -ne $endpoint) {
    Write-Host 'ブラウザーで自分のDiscordアカウントを認証してください。'
    & $cli mcp add company-discord --url $endpoint
    if ($LASTEXITCODE -ne 0) { throw '認証を完了できませんでした。もう一度このファイルを開いてください。' }
    if (-not (Get-DiscordTools $cli)) { throw '登録後のツール接続を確認できません。もう一度このファイルを開いてください。' }
  } elseif (-not (Get-DiscordTools $cli)) {
    Write-Host 'ブラウザーで自分のDiscordアカウントを認証してください。'
    & $cli mcp login company-discord
    if ($LASTEXITCODE -ne 0 -or -not (Get-DiscordTools $cli)) { throw '接続を完了できませんでした。認証画面の内容を管理者に伝えてください。' }
  }
  Write-Host ''
  Write-Host '接続できました。CodexからDiscordのツールを取得できています。' -ForegroundColor Green
  Write-Host 'Codexアプリを終了して開き直し、新しいチャットで次のように依頼してください。'
  Write-Host '「会社Discordでログイン中の自分と、チャンネル一覧を確認して」'
  exit 0
} catch {
  Write-Host $_.Exception.Message -ForegroundColor Red
  exit 1
}

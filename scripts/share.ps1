param([ValidateSet('start','stop','status','reload')][string]$Action = 'status')
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskName = 'Akagumi-Discord-MCP-Temporary'
$stateFile = Join-Path $taskRoot 'data\share-runtime.json'
if ($Action -eq 'start') {
  $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  if ($task -and $task.State -eq 'Running') { Write-Output 'Already running.' }
  else {
    if (-not (Test-Path -LiteralPath (Join-Path $taskRoot '.tools\cloudflared.exe'))) { throw 'cloudflared.exe is missing.' }
    if (-not (Test-Path -LiteralPath (Join-Path $taskRoot 'dist\index.js'))) { throw 'Run npm run build first.' }
    $nodePath = (Get-Command node).Source
    $workerPath = Join-Path $PSScriptRoot 'share-worker.mjs'
    $taskAction = New-ScheduledTaskAction -Execute $nodePath -Argument ('"' + $workerPath + '"') -WorkingDirectory $taskRoot
    $taskPrincipal = New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
    $taskSettings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    Register-ScheduledTask -TaskName $taskName -Action $taskAction -Principal $taskPrincipal -Settings $taskSettings -Description 'Temporary company Discord MCP; starts manually and runs while this PC is signed in.' -Force | Out-Null
    $startedAfter = [DateTime]::UtcNow
    Start-ScheduledTask -TaskName $taskName
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
      Start-Sleep -Milliseconds 500
      if (Test-Path -LiteralPath $stateFile) {
        try {
          $startedState = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
          if ($startedState.startedAt -and [DateTime]::Parse($startedState.startedAt).ToUniversalTime() -ge $startedAfter -and $startedState.callbackUrl) { break }
        } catch { }
      }
    }
    Write-Output 'Started. Register the callback URL in Discord before distributing the client settings.'
  }
} elseif ($Action -eq 'stop') {
  Stop-ScheduledTask -TaskName $taskName
  if (Test-Path -LiteralPath $stateFile) {
    $stoppedState = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
    $stoppedState.status = 'stopped'
    $stoppedState | ConvertTo-Json | Set-Content -LiteralPath $stateFile
  }
  Write-Output 'Stopped the temporary MCP task.'
} elseif ($Action -eq 'reload') {
  [guid]::NewGuid().ToString() | Set-Content -LiteralPath (Join-Path $taskRoot 'data\reload-server.txt')
  Write-Output 'Requested server reload; the tunnel URL stays the same.'
}
if (Test-Path -LiteralPath $stateFile) {
  $state = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
  $state | Select-Object status,publicUrl,callbackUrl,startedAt | Format-List
}

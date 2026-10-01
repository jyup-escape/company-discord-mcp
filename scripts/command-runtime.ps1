param([ValidateSet('start','status','stop')][string]$Action = 'status')
$ErrorActionPreference = 'Stop'
$commandRoot = Split-Path -Parent $PSScriptRoot
$taskName = 'Akagumi-Command-Polling'
$statePath = Join-Path $commandRoot 'data\command-runtime.json'
if ($Action -eq 'start') {
    if (-not (Test-Path -LiteralPath (Join-Path $commandRoot '.env.command'))) { throw 'Missing .env.command' }
    if (-not (Test-Path -LiteralPath (Join-Path $commandRoot '.tools\cloudflared.exe'))) { throw 'Missing .tools\cloudflared.exe' }
    $existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if (-not $existing -or $existing.State -ne 'Running') {
        $nodePath = (Get-Command node).Source
        $workerPath = Join-Path $PSScriptRoot 'command-worker.mjs'
        $taskAction = New-ScheduledTaskAction -Execute $nodePath -Argument ('"' + $workerPath + '"') -WorkingDirectory $commandRoot
        $principal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
        $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
        Register-ScheduledTask -TaskName $taskName -Action $taskAction -Principal $principal -Settings $settings -Description 'Authenticated command queue and temporary HTTPS tunnel; manually started while signed in.' -Force | Out-Null
        Start-ScheduledTask -TaskName $taskName
    }
} elseif ($Action -eq 'stop') {
    if (Test-Path -LiteralPath $statePath) {
        $state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
        $expected = @{
            serverPid = 'scripts/command-server.mjs'
            tunnelPid = 'http://127.0.0.1:8787'
            workerPid = 'command-worker.mjs'
        }
        foreach ($field in @('serverPid','tunnelPid','workerPid')) {
            $pidValue = $state.$field
            if ($pidValue) {
                $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $pidValue"
                if ($processInfo -and $processInfo.CommandLine.Contains($expected[$field])) {
                    Stop-Process -Id $pidValue -ErrorAction SilentlyContinue
                }
            }
        }
        $state.status = 'stopped'
        $state | ConvertTo-Json | Set-Content -LiteralPath $statePath
    }
}
if (Test-Path -LiteralPath $statePath) {
    Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json | Select-Object status,publicUrl,startedAt
}

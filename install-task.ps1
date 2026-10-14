# Registers a Windows Task Scheduler task that runs `node daily.mjs --week --go` when you log in.
# Run it once on each computer:  powershell -ExecutionPolicy Bypass -File install-task.ps1
# Remove it again with:          Unregister-ScheduledTask -TaskName KalorickeTabulkySender -Confirm:$false
# Output of every run is appended to daily.log in this folder.

$taskName = "KalorickeTabulkySender"
$projectDir = $PSScriptRoot
$node = (Get-Command node -ErrorAction Stop).Source

# daily.log is written as UTF-8 (PowerShell 5.1's `*>>` would produce UTF-16). The console encoding is set to
# UTF-8 so node's Czech output is decoded correctly, and stderr lines are turned into plain text.
$command = "Set-Location -LiteralPath '$projectDir'; " +
           "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; " +
           "('--- ' + (Get-Date -Format s)) | Out-File -FilePath daily.log -Append -Encoding utf8; " +
           "& '$node' daily.mjs --week --go 2>&1 | ForEach-Object { `$_.ToString() } | Out-File -FilePath daily.log -Append -Encoding utf8"

$action = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -Command `"$command`""

# One minute after logon, so the network is up.
$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$trigger.Delay = "PT1M"

# Retry a few times if it fails (e.g. no internet yet); a finished day is skipped by sent.json anyway.
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 10) -ExecutionTimeLimit (New-TimeSpan -Hours 1)

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings `
    -Description "Sends the canteen lunches of the week to Kalorické tabulky" -Force | Out-Null

Write-Host "Task '$taskName' registered. It runs 1 minute after you log in. Log: $projectDir\daily.log"

# Registers a Windows Task Scheduler task that runs `node daily.mjs --go` when you log in.
# Run it once on each computer:  powershell -ExecutionPolicy Bypass -File install-task.ps1
# Remove it again with:          Unregister-ScheduledTask -TaskName KalorickeTabulkySender -Confirm:$false
# Output of every run is appended to daily.log in this folder.

$taskName = "KalorickeTabulkySender"
$projectDir = $PSScriptRoot
$node = (Get-Command node -ErrorAction Stop).Source

$command = "Set-Location -LiteralPath '$projectDir'; " +
           "Add-Content -Path daily.log -Value ('--- ' + (Get-Date -Format s)); " +
           "& '$node' daily.mjs --go *>> daily.log"

$action = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -Command `"$command`""

# One minute after logon, so the network is up.
$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$trigger.Delay = "PT1M"

# Retry a few times if it fails (e.g. no internet yet); a finished day is skipped by sent.json anyway.
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 10) -ExecutionTimeLimit (New-TimeSpan -Hours 1)

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings `
    -Description "Sends today's canteen lunch to Kalorické tabulky" -Force | Out-Null

Write-Host "Task '$taskName' registered. It runs 1 minute after you log in. Log: $projectDir\daily.log"

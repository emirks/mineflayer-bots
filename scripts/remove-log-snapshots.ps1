<#
.SYNOPSIS
  Delete only snapshots.jsonl under mineflayer-bots/logs (recursive). Never touches session.log or other files.

.DESCRIPTION
  If you see "Access is denied", the file is almost always locked by a running bot (node keeps snapshots.jsonl open)
  or another process. Stop orchestrator/node first, then re-run. This script clears the Read-Only attribute before delete.

.PARAMETER LogsRoot
  Root folder to scan (default: ../logs next to this script).

.PARAMETER WhatIf
  Print paths that would be deleted; do not remove anything.

.PARAMETER Retries
  On delete failure, wait 250ms and retry (default 0). Use 3 if another process may release the lock soon.

.EXAMPLE
  powershell -NoProfile -File .\remove-log-snapshots.ps1 -WhatIf

.EXAMPLE
  powershell -NoProfile -File .\remove-log-snapshots.ps1
#>
[CmdletBinding()]
param(
  [string]$LogsRoot,
  [switch]$WhatIf,
  [int]$Retries = 0
)

$scriptDir = $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($scriptDir)) {
  $scriptDir = Split-Path -LiteralPath $MyInvocation.MyCommand.Path -Parent
}
if ([string]::IsNullOrWhiteSpace($LogsRoot)) {
  $LogsRoot = Join-Path $scriptDir '..\logs'
}
$LogsRoot = [System.IO.Path]::GetFullPath($LogsRoot)

$onlyName = 'snapshots.jsonl'

if (-not (Test-Path -LiteralPath $LogsRoot)) {
  Write-Error "Logs root not found: $LogsRoot"
  exit 1
}

$candidates = @(
  Get-ChildItem -LiteralPath $LogsRoot -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object {
      [string]::Equals($_.Name, $onlyName, [System.StringComparison]::OrdinalIgnoreCase)
    }
)

# Snapshot paths so enumeration vs delete races are less confusing.
$paths = @($candidates | ForEach-Object { $_.FullName } | Sort-Object -Unique)

$plannedBytes = [int64]0
foreach ($f in $candidates) {
  if ([string]::Equals($f.Name, $onlyName, [System.StringComparison]::OrdinalIgnoreCase)) {
    $plannedBytes += $f.Length
  }
}

$ok = 0
$fail = 0
$freedBytes = [int64]0
$failures = New-Object System.Collections.Generic.List[string]

function Clear-FileReadOnly([string]$path) {
  try {
    $fi = Get-Item -LiteralPath $path -Force -ErrorAction Stop
    if ($fi.Attributes -band [System.IO.FileAttributes]::ReadOnly) {
      $fi.Attributes = $fi.Attributes -band (-bnot [System.IO.FileAttributes]::ReadOnly)
    }
  }
  catch {
    # ignore
  }
}

foreach ($fullPath in $paths) {
  if (-not [string]::Equals([System.IO.Path]::GetFileName($fullPath), $onlyName, [System.StringComparison]::OrdinalIgnoreCase)) {
    continue
  }

  if ($WhatIf) {
    if (Test-Path -LiteralPath $fullPath) {
      $sz = (Get-Item -LiteralPath $fullPath -Force).Length
      Write-Host "[WhatIf] Would delete: $fullPath  ($sz bytes)"
      $ok++
    }
    continue
  }

  if (-not (Test-Path -LiteralPath $fullPath)) {
    $failures.Add("Missing (skipped): $fullPath")
    $fail++
    continue
  }

  $sizeBefore = (Get-Item -LiteralPath $fullPath -Force).Length
  $deleted = $false
  $attempts = 1 + [math]::Max(0, $Retries)
  for ($i = 0; $i -lt $attempts -and -not $deleted; $i++) {
    try {
      Clear-FileReadOnly $fullPath
      Remove-Item -LiteralPath $fullPath -Force -ErrorAction Stop
      $deleted = $true
    }
    catch {
      if ($i -lt $attempts - 1) {
        Start-Sleep -Milliseconds 250
      }
      else {
        $failures.Add("$fullPath  ->  $($_.Exception.Message)")
      }
    }
  }

  if ($deleted) {
    $ok++
    $freedBytes += $sizeBefore
  }
  else {
    $fail++
  }
}

Write-Host ''
Write-Host "Logs root: $LogsRoot" -ForegroundColor Cyan
Write-Host "File name filter: $onlyName only (recursive)" -ForegroundColor Cyan
Write-Host "Candidates: $($paths.Count) path(s)  (~$([math]::Round($plannedBytes/1MB, 2)) MB on disk before run)" -ForegroundColor Cyan

if ($WhatIf) {
  Write-Host "[WhatIf] Would process: $ok file(s)" -ForegroundColor Yellow
}
else {
  Write-Host "Deleted: $ok file(s)  (~$([math]::Round($freedBytes/1MB, 2)) MB)" -ForegroundColor Green
  if ($fail -gt 0) {
    Write-Host "Failed:  $fail file(s)" -ForegroundColor Red
    Write-Host 'Tip: stop node/orchestrator so nothing holds snapshots.jsonl open, then run again. Run PowerShell as Administrator only if files are ACL-locked.' -ForegroundColor Yellow
    $failures | Select-Object -First 40 | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkYellow }
    if ($failures.Count -gt 40) {
      Write-Host ("  ... and {0} more." -f ($failures.Count - 40)) -ForegroundColor DarkYellow
    }
    exit 2
  }
}

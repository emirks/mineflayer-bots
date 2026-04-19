<#
.SYNOPSIS
  Summarize all redstone_auction* profile logs for one calendar day: every unique sold item gets its own
  revenue + time + rate metrics, then combined totals.

.DESCRIPTION
  Discovers logs/redstone_auction* (or use -LogRoots / -LogRoot). Parses [CHAT] lines matching:
    bought your <Item Name> for $<amount>[K|M|B]
  Each distinct item name (after trim / collapse spaces) is its own bucket; matching is case-insensitive
  on the key, and the first-seen spelling is used for labels.

  Session duration is split across items proportionally to sale-line counts in that session.
  Sessions with no matching lines accrue to Idle.

.PARAMETER LogRoots
  Explicit log parent folders (each contains dated subfolders).

.PARAMETER LogRoot
  Single folder (backward compatible).

.PARAMETER DateFolder
  Day folder name, e.g. 2026-04-19

.EXAMPLE
  powershell -NoProfile -File .\redstone-auction-day-summary.ps1 -DateFolder 2026-04-19 -PerRun
#>
[CmdletBinding()]
param(
  [string]$DateFolder = '2026-04-19',
  [string[]]$LogRoots,
  [string]$LogRoot,
  [switch]$PerRun
)

$scriptDir = $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($scriptDir)) {
  $scriptDir = Split-Path -LiteralPath $MyInvocation.MyCommand.Path -Parent
}
$logsParent = [System.IO.Path]::GetFullPath((Join-Path $scriptDir '..\logs'))

if ($LogRoots -and $LogRoots.Count -gt 0) {
  $resolvedRoots = @($LogRoots | ForEach-Object { [System.IO.Path]::GetFullPath($_) })
}
elseif (-not [string]::IsNullOrWhiteSpace($LogRoot)) {
  $resolvedRoots = @([System.IO.Path]::GetFullPath($LogRoot))
}
else {
  if (-not (Test-Path -LiteralPath $logsParent)) {
    Write-Error "Logs folder not found: $logsParent"
    exit 1
  }
  $resolvedRoots = @(
    Get-ChildItem -LiteralPath $logsParent -Directory -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -like 'redstone_auction*' } |
      Sort-Object Name |
      ForEach-Object { $_.FullName }
  )
  if ($resolvedRoots.Count -eq 0) {
    Write-Error "No directories matching 'redstone_auction*' under: $logsParent"
    exit 1
  }
}

$dayPaths = @()
foreach ($r in $resolvedRoots) {
  $dp = Join-Path $r $DateFolder
  if (Test-Path -LiteralPath $dp) {
    $dayPaths += [pscustomobject]@{ Root = $r; Name = (Split-Path $r -Leaf); DayPath = $dp }
  }
  else {
    Write-Warning "Skipping missing day folder: $dp"
  }
}
if ($dayPaths.Count -eq 0) {
  Write-Error "No data for date '$DateFolder' under any log root."
  exit 1
}

$reSale = [regex]'(?i)\[CHAT\].*?\bbought your\s+(.+?)\s+for\s*\$'
$reMoney = [regex]'\$(\d+(?:\.\d+)?)([KMB]?)'
$reTs = [regex]'^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3})'
$inv = [System.Globalization.CultureInfo]::InvariantCulture

function Normalize-ItemKey([string]$raw) {
  $t = ($raw -replace '\s+', ' ').Trim()
  return $t.ToLowerInvariant()
}

function Parse-Money([System.Text.RegularExpressions.Match]$m) {
  $n = [double]$m.Groups[1].Value
  switch ($m.Groups[2].Value) {
    'K' { return $n * 1000 }
    'M' { return $n * 1e6 }
    'B' { return $n * 1e9 }
    default { return $n }
  }
}

function Parse-UptimeStr([string]$s) {
  $h = 0; $mi = 0; $sec = 0
  if ($s -match '(\d+)h') { $h = [int]$Matches[1] }
  if ($s -match '(\d+)m') { $mi = [int]$Matches[1] }
  if ($s -match '(\d+)s') { $sec = [int]$Matches[1] }
  return [double]($h * 3600 + $mi * 60 + $sec)
}

function Parse-LogTime([string]$line) {
  $m = $script:reTs.Match($line)
  if (-not $m.Success) { return $null }
  return [datetime]::ParseExact(
    $m.Groups[1].Value,
    'yyyy-MM-dd HH:mm:ss.fff',
    [System.Globalization.CultureInfo]::InvariantCulture
  )
}

function Get-SessionSeconds([string[]]$lines) {
  $uptLine = $lines | Where-Object { $_ -match 'CONNECTED .+ STOPPED \| uptime:\s*(.+)$' } | Select-Object -Last 1
  if ($uptLine -and $uptLine -match 'uptime:\s*(.+)$') {
    return @{
      Seconds = (Parse-UptimeStr $Matches[1].Trim())
      Method  = 'connected_uptime'
    }
  }

  $tConnectedLine = $lines | Where-Object { $_ -match 'CONNECTING .+ CONNECTED' } | Select-Object -First 1
  $t0 = $null
  if ($tConnectedLine) { $t0 = Parse-LogTime $tConnectedLine }
  if (-not $t0) {
    foreach ($ln in $lines) {
      $t0 = Parse-LogTime $ln
      if ($t0) { break }
    }
  }

  $t1 = $null
  for ($i = $lines.Count - 1; $i -ge 0; $i--) {
    $t1 = Parse-LogTime $lines[$i]
    if ($t1) { break }
  }

  if ($t0 -and $t1) {
    return @{
      Seconds = [math]::Max(0.0, ($t1 - $t0).TotalSeconds)
      Method  = 'timestamp_span'
    }
  }

  return @{ Seconds = 0.0; Method = 'none' }
}

function Format-Hms([double]$totalSeconds) {
  $ts = [timespan]::FromSeconds([math]::Floor($totalSeconds + 0.5))
  if ($ts.TotalHours -ge 24) {
    return ('{0}d {1:00}:{2:00}:{3:00}' -f [int][math]::Floor($ts.TotalDays), $ts.Hours, $ts.Minutes, $ts.Seconds)
  }
  return ('{0:00}:{1:00}:{2:00}' -f [int][math]::Floor($ts.TotalHours), $ts.Minutes, $ts.Seconds)
}

function Format-Money([double]$v) {
  if ([double]::IsNaN($v) -or [double]::IsInfinity($v)) { return 'n/a' }
  return [string]::Format([System.Globalization.CultureInfo]::InvariantCulture, '${0:#,0.00}', $v)
}

function Get-Metrics([double]$usd, [double]$sec, [int]$sales) {
  $mean = if ($sales -gt 0) { $usd / $sales } else { [double]::NaN }
  $perMin = if ($sec -gt 0) { $usd / ($sec / 60.0) } else { [double]::NaN }
  $perHr = if ($sec -gt 0) { $usd / ($sec / 3600.0) } else { [double]::NaN }
  $projDay = if ($sec -gt 0) { $usd * 86400.0 / $sec } else { [double]::NaN }
  return [pscustomobject]@{
    DayTotalUsd     = $usd
    MeanPerSaleUsd  = $mean
    PerMinUsd       = $perMin
    PerHrUsd        = $perHr
    Projected24hUsd = $projDay
    Sales           = $sales
    Seconds         = $sec
  }
}

function Ensure-GlobalItem([hashtable]$globalItems, [string]$key, [string]$display) {
  if (-not $globalItems.ContainsKey($key)) {
    $globalItems[$key] = @{
      Display = $display
      Usd     = 0.0
      Sales   = 0
      Sec     = 0.0
    }
  }
}

function Ensure-SourceItem([hashtable]$srcBucket, [string]$key, [string]$display) {
  $it = $srcBucket.Items
  if (-not $it.ContainsKey($key)) {
    $it[$key] = @{
      Display = $display
      Usd     = 0.0
      Sales   = 0
      Sec     = 0.0
    }
  }
}

# --- global per item key ---
$items = @{}
$idleSec = 0.0
$rows = New-Object System.Collections.Generic.List[object]

# --- per log root: @{ IdleSec; Items = @{ key -> row } } ---
$bySource = @{}

foreach ($entry in $dayPaths) {
  $srcName = $entry.Name
  if (-not $bySource.ContainsKey($srcName)) {
    $bySource[$srcName] = @{
      IdleSec = 0.0
      Items   = @{}
    }
  }
  $srcBucket = $bySource[$srcName]

  Get-ChildItem -LiteralPath $entry.DayPath -Recurse -Filter 'session.log' -ErrorAction SilentlyContinue |
    Sort-Object @{ Expression = { [int]($_.Directory.Name -replace '\D', '') }; Ascending = $true } |
    ForEach-Object {

      $run = $_.Directory.Name
      $lines = Get-Content -LiteralPath $_.FullName
      $dur = Get-SessionSeconds $lines

      $sessionCounts = @{}

      foreach ($ln in $lines) {
        if ($ln -notmatch '\[CHAT\]') { continue }
        $sm = $reSale.Match($ln)
        if (-not $sm.Success) { continue }

        $display = ($sm.Groups[1].Value -replace '\s+', ' ').Trim()
        if ([string]::IsNullOrWhiteSpace($display)) { continue }

        $key = Normalize-ItemKey $display
        $mm = $reMoney.Match($ln)
        if (-not $mm.Success) { continue }
        $v = Parse-Money $mm

        Ensure-GlobalItem $items $key $display

        $items[$key].Usd += $v
        $items[$key].Sales++

        Ensure-SourceItem $srcBucket $key $display
        $srcItem = $srcBucket.Items[$key]
        $srcItem.Usd += $v
        $srcItem.Sales++

        if ($sessionCounts.ContainsKey($key)) {
          $sessionCounts[$key]++
        }
        else {
          $sessionCounts[$key] = 1
        }
      }

      $w = 0
      foreach ($n in $sessionCounts.Values) { $w += $n }

      if ($w -le 0) {
        $idleSec += $dur.Seconds
        $srcBucket.IdleSec += $dur.Seconds
        $bucket = 'idle'
        $mix = ''
      }
      else {
        $fw = [double]$w
        foreach ($ent in $sessionCounts.GetEnumerator()) {
          $k = $ent.Key
          $c = $ent.Value
          $share = $dur.Seconds * ($c / $fw)
          $items[$k].Sec += $share
          $srcBucket.Items[$k].Sec += $share
        }
        $bucket = if ($sessionCounts.Count -eq 1) { 'single' } else { 'mixed' }
        $mix = (
          $sessionCounts.GetEnumerator() |
            Sort-Object { $_.Key } |
            ForEach-Object {
              $d = $items[$_.Key].Display
              '{0}:{1}' -f $d, $_.Value
            }
        ) -join ', '
      }

      if ($PerRun) {
        $rows.Add([pscustomobject]@{
          Source   = $srcName
          Run      = $run
          Bucket   = $bucket
          Mix      = $mix
          Seconds  = [math]::Round($dur.Seconds, 1)
          Duration = (Format-Hms $dur.Seconds)
          Method   = $dur.Method
        }) | Out-Null
      }
    }
}

$activeSec = 0.0
foreach ($it in $items.Values) { $activeSec += $it.Sec }
$grandSec = $activeSec + $idleSec

$totalUsd = 0.0
$totalSales = 0
foreach ($it in $items.Values) {
  $totalUsd += $it.Usd
  $totalSales += $it.Sales
}

$mActive = Get-Metrics $totalUsd $activeSec $totalSales
$mGrand = Get-Metrics $totalUsd $grandSec $totalSales

$itemOrder = $items.GetEnumerator() |
  ForEach-Object { [pscustomobject]@{ Key = $_.Key; Row = $_.Value } } |
  Sort-Object { $_.Row.Usd } -Descending

Write-Host ''
Write-Host "=== redstone_auction* / $DateFolder ===" -ForegroundColor Cyan
Write-Host 'Log roots scanned:'
foreach ($e in $dayPaths) {
  Write-Host ("  - {0}" -f $e.DayPath)
}
Write-Host ''

Write-Host '--- Process time by item (proportional share per run) + idle ---' -ForegroundColor Yellow
foreach ($io in $itemOrder) {
  $r = $io.Row
  Write-Host ("  {0,-42} {1}  ({2} s)" -f $r.Display, (Format-Hms $r.Sec), ([string]::Format($inv, '{0:N0}', $r.Sec)))
}
Write-Host ("  {0,-42} {1}  ({2} s)" -f '(Idle - no tracked CHAT sales)', (Format-Hms $idleSec), ([string]::Format($inv, '{0:N0}', $idleSec)))
Write-Host ("  {0,-42} {1}  ({2} s)" -f 'ACTIVE (all items)', (Format-Hms $activeSec), ([string]::Format($inv, '{0:N0}', $activeSec))) -ForegroundColor DarkGray
Write-Host ("  {0,-42} {1}  ({2} s)" -f 'GRAND (active + idle)', (Format-Hms $grandSec), ([string]::Format($inv, '{0:N0}', $grandSec))) -ForegroundColor Green
Write-Host ''

Write-Host '--- CHAT revenue by item ---' -ForegroundColor Yellow
foreach ($io in $itemOrder) {
  $r = $io.Row
  Write-Host ("  {0,-42} {1}  ({2} sales)" -f $r.Display, (Format-Money $r.Usd), ([string]::Format($inv, '{0:N0}', $r.Sales)))
}
Write-Host ("  {0,-42} {1}  ({2} sales)" -f 'TOTAL', (Format-Money $totalUsd), ([string]::Format($inv, '{0:N0}', $totalSales))) -ForegroundColor Green
Write-Host ''

function Write-MetricsBlock([string]$title, $m) {
  Write-Host $title -ForegroundColor Yellow
  Write-Host ("  Total this calendar day: {0}" -f (Format-Money $m.DayTotalUsd))
  Write-Host ("  Mean per sale:           {0}" -f (Format-Money $m.MeanPerSaleUsd))
  Write-Host ("  Revenue / minute:        {0}" -f (Format-Money $m.PerMinUsd))
  Write-Host ("  Revenue / hour:          {0}" -f (Format-Money $m.PerHrUsd))
  Write-Host ("  Projected / 24h wall:    {0}  (if `$ / sec stayed constant for this bucket)" -f (Format-Money $m.Projected24hUsd))
  Write-Host ''
}

Write-Host '--- Per-item rates (time = that item''s share of each session) ---' -ForegroundColor Cyan
foreach ($io in $itemOrder) {
  $r = $io.Row
  $m = Get-Metrics $r.Usd $r.Sec $r.Sales
  Write-MetricsBlock ("--- {0} ---" -f $r.Display) $m
}

Write-MetricsBlock '--- ALL ITEMS (active time only; full day revenue) ---' $mActive
Write-MetricsBlock '--- GRAND (all session wall time incl. idle; full day revenue) ---' $mGrand

Write-Host '--- By log root (per item + idle) ---' -ForegroundColor Cyan
foreach ($sk in ($bySource.Keys | Sort-Object)) {
  $sb = $bySource[$sk]
  Write-Host ("[{0}]" -f $sk) -ForegroundColor DarkCyan
  Write-Host ("  Idle: {0}  ({1} s)" -f (Format-Hms $sb.IdleSec), ([string]::Format($inv, '{0:N0}', $sb.IdleSec)))
  $srcItems = $sb.Items.GetEnumerator() |
    ForEach-Object { [pscustomobject]@{ Key = $_.Key; R = $_.Value } } |
    Sort-Object { $_.R.Usd } -Descending
  foreach ($si in $srcItems) {
    $r = $si.R
    $m = Get-Metrics $r.Usd $r.Sec $r.Sales
    Write-Host ("  {0,-36} rev {1,-18} time {2,-12} sales {3,6}  {4}/hr" -f $r.Display, (Format-Money $r.Usd), (Format-Hms $r.Sec), $r.Sales, (Format-Money $m.PerHrUsd))
  }
  $subUsd = 0.0; $subSales = 0; $sumItemSec = 0.0
  foreach ($r in $sb.Items.Values) {
    $subUsd += $r.Usd
    $subSales += $r.Sales
    $sumItemSec += $r.Sec
  }
  $wall = $sumItemSec + $sb.IdleSec
  Write-Host ("  {0,-36} rev {1,-18} wall {2,-12} sales {3,6}" -f 'SUBTOTAL (this root)', (Format-Money $subUsd), (Format-Hms $wall), $subSales)
  Write-Host ''
}

if ($PerRun -and $rows.Count -gt 0) {
  Write-Host '--- Per session.log ---' -ForegroundColor Yellow
  $rows | Format-Table -AutoSize
}

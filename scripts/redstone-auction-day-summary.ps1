<#
.SYNOPSIS
  Summarize redstone_auction* logs: three non-overlapping CHAT gain streams + per-item splits + You paid by player.

.DESCRIPTION
  Revenue (mutually exclusive per line — classify in this order):
    1) You earned $X from auction  (optional " while you were away" at end; optional extra text after "from auction")
    2) <player> bought your <Item> for $X while you were away
    3) <player> bought your <Item> for $X  (live; no "while you were away")

  Also parses: You paid <Player> $X[.]

  Default: discovers mineflayer-bots/logs/redstone_auction* (relative to this script).
  With -LogRoot or -LogRoots: each path is a candidate root. If <root>/<DateFolder> does not exist,
  the script also tries each immediate child directory named redstone_auction* under that root
  (so e.g. -LogRoot .../logs/vm_logs/logs picks up .../vm_logs/logs/redstone_auction/...).

.PARAMETER DateFolder
  Day folder under each log root, e.g. 2026-04-20

.EXAMPLE
  powershell -NoProfile -File .\redstone-auction-day-summary.ps1 -DateFolder 2026-04-20
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

# If -LogRoot(s) point at a parent of profile folders (e.g. vm_logs/logs) rather than
# redstone_auction itself, expand to child directories matching redstone_auction*.
$expanded = New-Object System.Collections.Generic.List[string]
foreach ($r in $resolvedRoots) {
  $r = [System.IO.Path]::GetFullPath($r)
  $dp = Join-Path $r $DateFolder
  if (Test-Path -LiteralPath $dp) {
    $expanded.Add($r) | Out-Null
    continue
  }
  $subs = @(
    Get-ChildItem -LiteralPath $r -Directory -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -like 'redstone_auction*' } |
      Sort-Object Name
  )
  if ($subs.Count -gt 0) {
    foreach ($s in $subs) { $expanded.Add($s.FullName) | Out-Null }
  }
  else {
    $expanded.Add($r) | Out-Null
  }
}
$resolvedRoots = @($expanded)

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
$reYouEarned = [regex]'(?i)\[CHAT\].*?\bYou earned\s+\$(\d+(?:\.\d+)?)([KMB]?).*?\bfrom auction'
$reYouPaid = [regex]'(?i)\[CHAT\].*?\bYou paid\s+(.+?)\s+\$(\d+(?:\.\d+)?)([KMB]?)'
$reMoney = [regex]'\$(\d+(?:\.\d+)?)([KMB]?)'
$reTs = [regex]'^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3})'
$inv = [System.Globalization.CultureInfo]::InvariantCulture

$script:KeyYouEarned = '__you_earned_auction__'

function Normalize-ItemKey([string]$raw) {
  $t = ($raw -replace '\s+', ' ').Trim()
  return $t.ToLowerInvariant()
}

function Normalize-PayeeKey([string]$raw) {
  return ($raw -replace '\s+', ' ').Trim().ToLowerInvariant()
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

function Parse-MoneyGroups([double]$n, [string]$suff) {
  switch ($suff) {
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

function Ensure-Bucket([hashtable]$store, [string]$key, [string]$display) {
  if (-not $store.ContainsKey($key)) {
    $store[$key] = @{
      Display = $display
      Usd     = 0.0
      Sales   = 0
      Sec     = 0.0
    }
  }
}

function Ensure-Payee([hashtable]$store, [string]$key, [string]$display) {
  if (-not $store.ContainsKey($key)) {
    $store[$key] = @{
      Display = $display
      Usd     = 0.0
      Lines   = 0
    }
  }
}

$items = @{}
$idleSec = 0.0
$rows = New-Object System.Collections.Generic.List[object]
$bySource = @{}

$paidByPayee = @{}
$paidTotalUsd = 0.0
$paidLines = 0

$streamLiveUsd = 0.0; $streamLiveLines = 0
$streamAwayUsd = 0.0; $streamAwayLines = 0
$streamEarnedUsd = 0.0; $streamEarnedLines = 0

foreach ($entry in $dayPaths) {
  $srcName = $entry.Name
  if (-not $bySource.ContainsKey($srcName)) {
    $bySource[$srcName] = @{
      IdleSec = 0.0
      Items   = @{}
      Paid    = @{}
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

        # --- You paid (outflow; by player) ---
        $pm = $reYouPaid.Match($ln)
        if ($pm.Success) {
          $payeeRaw = $pm.Groups[1].Value.Trim()
          $pk = Normalize-PayeeKey $payeeRaw
          $pv = Parse-MoneyGroups ([double]$pm.Groups[2].Value) $pm.Groups[3].Value
          $paidTotalUsd += $pv
          $paidLines++
          Ensure-Payee $paidByPayee $pk $payeeRaw
          $paidByPayee[$pk].Usd += $pv
          $paidByPayee[$pk].Lines++
          Ensure-Payee $srcBucket.Paid $pk $payeeRaw
          $srcBucket.Paid[$pk].Usd += $pv
          $srcBucket.Paid[$pk].Lines++
        }

        # --- 1) You earned ... from auction ---
        $ye = $reYouEarned.Match($ln)
        if ($ye.Success) {
          $v = Parse-MoneyGroups ([double]$ye.Groups[1].Value) $ye.Groups[2].Value
          $streamEarnedUsd += $v
          $streamEarnedLines++
          $bk = $script:KeyYouEarned
          $disp = 'You earned (auction)'
          Ensure-Bucket $items $bk $disp
          $items[$bk].Usd += $v
          $items[$bk].Sales++
          Ensure-Bucket $srcBucket.Items $bk $disp
          $srcBucket.Items[$bk].Usd += $v
          $srcBucket.Items[$bk].Sales++
          if ($sessionCounts.ContainsKey($bk)) { $sessionCounts[$bk]++ } else { $sessionCounts[$bk] = 1 }
          continue
        }

        # --- 2 / 3) bought your ... for $ (away vs live) ---
        $sm = $reSale.Match($ln)
        if (-not $sm.Success) { continue }

        $display = ($sm.Groups[1].Value -replace '\s+', ' ').Trim()
        if ([string]::IsNullOrWhiteSpace($display)) { continue }

        $ik = Normalize-ItemKey $display
        $away = $ln -match 'while you were away'
        $prefix = if ($away) { 'away' } else { 'live' }
        $bk = '{0}::{1}' -f $prefix, $ik
        $baseDisp = ($sm.Groups[1].Value -replace '\s+', ' ').Trim()
        $disp = if ($away) { '{0} (offline sale)' -f $baseDisp } else { '{0} (live)' -f $baseDisp }

        $mm = $reMoney.Match($ln)
        if (-not $mm.Success) { continue }
        $v = Parse-Money $mm

        if ($away) {
          $streamAwayUsd += $v
          $streamAwayLines++
        }
        else {
          $streamLiveUsd += $v
          $streamLiveLines++
        }

        Ensure-Bucket $items $bk $disp
        $items[$bk].Usd += $v
        $items[$bk].Sales++
        Ensure-Bucket $srcBucket.Items $bk $disp
        $srcBucket.Items[$bk].Usd += $v
        $srcBucket.Items[$bk].Sales++

        if ($sessionCounts.ContainsKey($bk)) { $sessionCounts[$bk]++ } else { $sessionCounts[$bk] = 1 }
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

$totalGainsUsd = $streamLiveUsd + $streamAwayUsd + $streamEarnedUsd
$totalGainLines = $streamLiveLines + $streamAwayLines + $streamEarnedLines

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

Write-Host '--- CHAT revenue streams (disjoint line types) ---' -ForegroundColor Yellow
Write-Host ("  Live bought your:        {0}  ({1} lines)" -f (Format-Money $streamLiveUsd), ([string]::Format($inv, '{0:N0}', $streamLiveLines)))
Write-Host ("  Offline bought your:     {0}  ({1} lines)" -f (Format-Money $streamAwayUsd), ([string]::Format($inv, '{0:N0}', $streamAwayLines)))
Write-Host ("  You earned (auction):    {0}  ({1} lines)" -f (Format-Money $streamEarnedUsd), ([string]::Format($inv, '{0:N0}', $streamEarnedLines)))
Write-Host ("  TOTAL CHAT gains:        {0}  ({1} lines)" -f (Format-Money $totalGainsUsd), ([string]::Format($inv, '{0:N0}', $totalGainLines))) -ForegroundColor Green
Write-Host ''

Write-Host '--- Total sent (You paid) by recipient ---' -ForegroundColor Yellow
Write-Host ("  All recipients combined: {0}  ({1} lines)" -f (Format-Money $paidTotalUsd), ([string]::Format($inv, '{0:N0}', $paidLines)))
foreach ($pe in ($paidByPayee.GetEnumerator() | Sort-Object { $_.Value.Usd } -Descending)) {
  $p = $pe.Value
  Write-Host ("  {0,-36} {1}  ({2} payments)" -f $p.Display, (Format-Money $p.Usd), $p.Lines)
}
Write-Host ''

Write-Host '--- Process time by bucket (proportional to line counts in session) + idle ---' -ForegroundColor Yellow
foreach ($io in $itemOrder) {
  $r = $io.Row
  Write-Host ("  {0,-48} {1}  ({2} s)" -f $r.Display, (Format-Hms $r.Sec), ([string]::Format($inv, '{0:N0}', $r.Sec)))
}
Write-Host ("  {0,-48} {1}  ({2} s)" -f '(Idle - no tracked gain lines)', (Format-Hms $idleSec), ([string]::Format($inv, '{0:N0}', $idleSec)))
Write-Host ("  {0,-48} {1}  ({2} s)" -f 'ACTIVE (all buckets)', (Format-Hms $activeSec), ([string]::Format($inv, '{0:N0}', $activeSec))) -ForegroundColor DarkGray
Write-Host ("  {0,-48} {1}  ({2} s)" -f 'GRAND (active + idle)', (Format-Hms $grandSec), ([string]::Format($inv, '{0:N0}', $grandSec))) -ForegroundColor Green
Write-Host ''

Write-Host '--- CHAT gains by bucket (live / offline item + you earned) ---' -ForegroundColor Yellow
foreach ($io in $itemOrder) {
  $r = $io.Row
  Write-Host ("  {0,-48} {1}  ({2} lines)" -f $r.Display, (Format-Money $r.Usd), ([string]::Format($inv, '{0:N0}', $r.Sales)))
}
Write-Host ("  {0,-48} {1}  ({2} lines)" -f 'TOTAL (sum buckets)', (Format-Money $totalUsd), ([string]::Format($inv, '{0:N0}', $totalSales))) -ForegroundColor Green
Write-Host ''

function Write-MetricsBlock([string]$title, $m) {
  Write-Host $title -ForegroundColor Yellow
  Write-Host ("  Total this calendar day: {0}" -f (Format-Money $m.DayTotalUsd))
  Write-Host ("  Mean per line:           {0}" -f (Format-Money $m.MeanPerSaleUsd))
  Write-Host ("  Revenue / minute:        {0}" -f (Format-Money $m.PerMinUsd))
  Write-Host ("  Revenue / hour:          {0}" -f (Format-Money $m.PerHrUsd))
  Write-Host ("  Projected / 24h wall:    {0}  (if `$ / sec stayed constant for this bucket)" -f (Format-Money $m.Projected24hUsd))
  Write-Host ''
}

Write-Host '--- Per-bucket rates ---' -ForegroundColor Cyan
foreach ($io in $itemOrder) {
  $r = $io.Row
  $m = Get-Metrics $r.Usd $r.Sec $r.Sales
  Write-MetricsBlock ("--- {0} ---" -f $r.Display) $m
}

Write-MetricsBlock '--- ALL CHAT GAINS (active time only) ---' $mActive
Write-MetricsBlock '--- GRAND (all session wall time incl. idle; same CHAT gains) ---' $mGrand

Write-Host '--- By log root ---' -ForegroundColor Cyan
foreach ($sk in ($bySource.Keys | Sort-Object)) {
  $sb = $bySource[$sk]
  Write-Host ("[{0}]" -f $sk) -ForegroundColor DarkCyan
  Write-Host ("  Idle: {0}  ({1} s)" -f (Format-Hms $sb.IdleSec), ([string]::Format($inv, '{0:N0}', $sb.IdleSec)))

  $subGains = 0.0; $subGainLines = 0; $sumItemSec = 0.0
  $srcItems = $sb.Items.GetEnumerator() |
    ForEach-Object { [pscustomobject]@{ Key = $_.Key; R = $_.Value } } |
    Sort-Object { $_.R.Usd } -Descending
  foreach ($si in $srcItems) {
    $r = $si.R
    $m = Get-Metrics $r.Usd $r.Sec $r.Sales
    Write-Host ("  {0,-40} rev {1,-18} time {2,-12} lines {3,6}  {4}/hr" -f $r.Display, (Format-Money $r.Usd), (Format-Hms $r.Sec), $r.Sales, (Format-Money $m.PerHrUsd))
    $subGains += $r.Usd
    $subGainLines += $r.Sales
    $sumItemSec += $r.Sec
  }
  $wall = $sumItemSec + $sb.IdleSec
  Write-Host ("  {0,-40} rev {1,-18} wall {2,-12} lines {3,6}  (CHAT gains)" -f 'SUBTOTAL gains', (Format-Money $subGains), (Format-Hms $wall), $subGainLines)

  $subPaid = 0.0; $subPaidLines = 0
  foreach ($pv in $sb.Paid.Values) {
    $subPaid += $pv.Usd
    $subPaidLines += $pv.Lines
  }
  Write-Host ("  {0,-40} {1}  ({2} lines)  (You paid out)" -f 'SUBTOTAL paid', (Format-Money $subPaid), $subPaidLines)
  Write-Host ''
}

if ($PerRun -and $rows.Count -gt 0) {
  Write-Host '--- Per session.log ---' -ForegroundColor Yellow
  $rows | Format-Table -AutoSize
}

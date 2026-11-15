# preflight.ps1: is this Windows PC ready for Supersuit? (#2839)
#
# READ-ONLY. Installs nothing, changes nothing, needs no admin. Runs in about a minute.
# Grades the PC, prints one verdict line, and ends with a SUPERSUIT READINESS REPORT that is saved
# to Downloads and copied to the clipboard, so it can be pasted into an email to the Supersuit team.
#
# Usage, in Windows PowerShell:
#   irm https://supersuit.co/preflight.ps1 | iex
#
# Earned 2026-11-14: a member's install stopped on the call because his company's policy blocked
# Windows Package Manager ("Access is denied", #2837), and nothing had checked for it the day before.
# Gary: "there almost needs to be a script that they can put into their PowerShell next time that just
# evaluates whether their machine is ready for Supersuit".
#
# Two layers. Read-Facts reads the PC; everything after it grades those facts and never touches the
# PC again. SUPERSUIT_PREFLIGHT_FACTS (a JSON file of facts) replaces the reading, which is how
# tests/preflight-report-2839.test.mjs pins the grading without a Windows PC.
#
# Windows PowerShell 5.1 is the floor: no ternary, no ??, no pipeline chain operators.

$ErrorActionPreference = 'Continue'
$Hosts = @('app.supersuit.co', 'wiki.supersuit.co', 'claude.ai', 'registry.npmjs.org', 'github.com')

# ---------- Reading the PC (skipped when facts are supplied) ----------

function First-Line([scriptblock]$sb) {
  try { $out = & $sb 2>$null | Select-Object -First 1; if ($out) { return "$out".Trim() } } catch {}
  return $null
}

function Tool-Version([string]$cmd, [string[]]$versionArgs) {
  $c = Get-Command $cmd -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $c) { return $null }
  # The Microsoft Store's python.exe is a stub that opens the Store, not Python.
  if ($c.Source -and $c.Source -match 'WindowsApps\\python') { return $null }
  return First-Line { & $c.Source @versionArgs }
}

function Read-Winget {
  $exe = Join-Path $env:LOCALAPPDATA 'Microsoft\WindowsApps\winget.exe'
  $cmd = Get-Command winget -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($cmd) { $exe = $cmd.Source }
  if (-not (Test-Path $exe)) { return 'missing' }
  # The installer starts winget through Start-Process, which is where a company block shows up as
  # "Access is denied" (#2837). Check that exact path, hidden, and the direct call too.
  try {
    $p = Start-Process -FilePath $exe -ArgumentList '--version' -WindowStyle Hidden -PassThru -Wait -ErrorAction Stop
    if ($p.ExitCode -ne 0) { return 'broken' }
  } catch {
    if ("$_" -match 'denied') { return 'denied' }
    return 'broken'
  }
  try { $null = & $exe --version 2>$null } catch { if ("$_" -match 'denied') { return 'denied' } }
  return 'ok'
}

function Read-Facts {
  $os = 'Windows'
  try {
    $cim = Get-CimInstance Win32_OperatingSystem -ErrorAction Stop
    $os = $cim.Caption -replace '^Microsoft\s+', ''
    $display = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion' -ErrorAction SilentlyContinue).DisplayVersion
    if ($display) { $os = "$os $display" }
  } catch {}
  $ram = 0
  try { $ram = [math]::Round((Get-CimInstance Win32_ComputerSystem -ErrorAction Stop).TotalPhysicalMemory / 1GB) } catch {}
  $disk = 0
  try { $disk = [math]::Round((Get-PSDrive -Name C -ErrorAction Stop).Free / 1GB) } catch {}

  $ds = ''
  try { $ds = (dsregcmd /status 2>$null) -join "`n" } catch {}
  $entra = $ds -match 'AzureAdJoined\s*:\s*YES'
  $domain = $ds -match 'DomainJoined\s*:\s*YES'
  $intune = [bool](Get-Service -Name 'IntuneManagementExtension' -ErrorAction SilentlyContinue)
  if (-not $intune -and $ds -match 'MdmUrl\s*:\s*https?://\S+') { $intune = $true }

  # Tools that stop elevation or unknown programs. Read from service and process names only.
  $known = [ordered]@{
    'AutoElevate' = 'AutoElevate'; 'CyberFOX' = 'AutoElevate'; 'ThreatLocker' = 'ThreatLocker';
    'BeyondTrust' = 'BeyondTrust'; 'Admin By Request' = 'Admin By Request'; 'AdminByRequest' = 'Admin By Request';
    'CyberArk' = 'CyberArk EPM'; 'PolicyPak' = 'PolicyPak'; 'Netwrix' = 'Netwrix'; 'Ivanti' = 'Ivanti'
  }
  $names = @()
  try { $names += (Get-Service -ErrorAction SilentlyContinue | ForEach-Object { "$($_.Name) $($_.DisplayName)" }) } catch {}
  try { $names += (Get-Process -ErrorAction SilentlyContinue | ForEach-Object { $_.ProcessName }) } catch {}
  $all = $names -join "`n"
  $tools = @()
  foreach ($k in $known.Keys) { if ($all -match [regex]::Escape($k) -and $tools -notcontains $known[$k]) { $tools += $known[$k] } }

  $git = Tool-Version 'git' @('--version')
  $bashPaths = @(
    (Join-Path $env:ProgramFiles 'Git\bin\bash.exe'),
    (Join-Path $env:LOCALAPPDATA 'Programs\Git\bin\bash.exe')
  )
  $gitBash = [bool]($bashPaths | Where-Object { Test-Path $_ } | Select-Object -First 1)

  $python = Tool-Version 'python' @('--version')
  if (-not $python) { $python = Tool-Version 'py' @('--version') }

  # A policy set by IT (MachinePolicy or UserPolicy) beats the installer's -ExecutionPolicy Bypass.
  $scriptsRun = $true
  foreach ($scope in @('MachinePolicy', 'UserPolicy')) {
    $pol = "$(Get-ExecutionPolicy -Scope $scope -ErrorAction SilentlyContinue)"
    if ($pol -in @('Restricted', 'AllSigned')) { $scriptsRun = $false }
  }

  $claudeApp = [bool](@(
    (Join-Path $env:LOCALAPPDATA 'AnthropicClaude'),
    (Join-Path $env:LOCALAPPDATA 'Programs\Claude'),
    (Join-Path $env:ProgramFiles 'Claude')
  ) | Where-Object { Test-Path $_ } | Select-Object -First 1)
  if (-not $claudeApp) { $claudeApp = [bool](Get-AppxPackage -Name '*Claude*' -ErrorAction SilentlyContinue) }
  $chrome = [bool](@(
    (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
    (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe')
  ) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1)

  $net = [ordered]@{}
  foreach ($h in $Hosts) {
    $ok = $false
    try {
      $null = Invoke-WebRequest -Uri "https://$h" -Method Head -UseBasicParsing -TimeoutSec 10 -MaximumRedirection 0 -ErrorAction Stop
      $ok = $true
    } catch {
      # Any answer from the server (a redirect, a 403) means it was reached.
      if ($_.Exception.Response) { $ok = $true }
    }
    $net[$h] = $ok
  }
  $proxy = ''
  try {
    $ie = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings' -ErrorAction Stop
    if ($ie.ProxyEnable -eq 1 -or $ie.AutoConfigURL) { $proxy = 'set' }
  } catch {}

  return [pscustomobject]@{
    os = $os; arch = $env:PROCESSOR_ARCHITECTURE; ramGB = $ram; diskFreeGB = $disk
    winget = (Read-Winget); entraJoined = [bool]$entra; domainJoined = [bool]$domain; intune = $intune; elevationTools = $tools
    node = (Tool-Version 'node' @('--version')); git = $git; gitBash = $gitBash; python = $python
    jq = (Tool-Version 'jq' @('--version')); claude = (Tool-Version 'claude' @('--version'))
    scriptsRun = $scriptsRun; claudeApp = $claudeApp; chrome = $chrome
    network = [pscustomobject]$net; proxy = $proxy
  }
}

Write-Host '=================================================='
Write-Host '  Supersuit READINESS CHECK (Windows)'
Write-Host '  Read-only: nothing is installed or changed.'
Write-Host '=================================================='
Write-Host '  Checking this PC, which takes about a minute...'

if ($env:SUPERSUIT_PREFLIGHT_FACTS) {
  $F = Get-Content -Raw -Path $env:SUPERSUIT_PREFLIGHT_FACTS | ConvertFrom-Json
} else {
  $F = Read-Facts
}

# ---------- Grading (facts only from here) ----------

$Rows = New-Object System.Collections.ArrayList
function Row([string]$status, [string]$label, [string]$detail) {
  $null = $Rows.Add([pscustomobject]@{ status = $status; label = $label; detail = $detail })
}
$Machine = 'https://wiki.supersuit.co/start-here/what-machine-you-need'

if (-not $F.ramGB) { Row 'WARN' 'RAM' 'could not be read on this PC; check Settings, System, About' }
elseif ($F.ramGB -ge 32) { Row 'PASS' 'RAM' "$($F.ramGB) GB (meets the 32 GB floor)" }
elseif ($F.ramGB -ge 16) { Row 'WARN' 'RAM' "$($F.ramGB) GB: runs, but 32 GB is the floor; expect fewer sessions at once. See $Machine" }
else { Row 'FAIL' 'RAM' "$($F.ramGB) GB: below the 16 GB minimum. See $Machine" }

if (-not $F.diskFreeGB) { Row 'WARN' 'Free disk' 'could not be read on this PC; check Settings, System, Storage' }
elseif ($F.diskFreeGB -ge 30) { Row 'PASS' 'Free disk' "$($F.diskFreeGB) GB free" }
elseif ($F.diskFreeGB -ge 15) { Row 'WARN' 'Free disk' "$($F.diskFreeGB) GB free: enough, but tight" }
else { Row 'FAIL' 'Free disk' "$($F.diskFreeGB) GB free: clear space first" }

Row 'PASS' 'Windows' "$($F.os) ($($F.arch))"

$managedBy = @()
if ($F.entraJoined) { $managedBy += 'Entra ID (work account)' }
if ($F.domainJoined) { $managedBy += 'a company domain' }
if ($F.intune) { $managedBy += 'Intune' }
foreach ($t in @($F.elevationTools)) { if ($t) { $managedBy += $t } }
$managed = $managedBy.Count -gt 0
if ($managed) { Row 'NOTE' 'Managed by' (($managedBy -join ', ') + ': your company''s IT controls this PC. If a step is blocked, send them the request below.') }

switch ($F.winget) {
  'ok' { Row 'PASS' 'winget' 'Windows Package Manager runs' }
  'denied' { Row 'FAIL' 'winget' 'Access is denied: your company''s IT blocks Windows Package Manager, which the installer uses. Running as administrator does not help.' }
  'missing' { Row 'WARN' 'winget' 'not found: install App Installer from the Microsoft Store (https://apps.microsoft.com/detail/9NBLGGH4NNS1), then open a new PowerShell' }
  default { Row 'WARN' 'winget' 'found, but it did not run cleanly: open the Microsoft Store and update App Installer' }
}

if (-not $F.scriptsRun) { Row 'FAIL' 'Scripts' 'your company''s policy stops PowerShell scripts, so the installer cannot run. Send IT the request below.' }
else { Row 'PASS' 'Scripts' 'PowerShell scripts can run' }

$toolRows = @(
  @{ key = 'node'; label = 'Node.js' }, @{ key = 'git'; label = 'Git' }, @{ key = 'python'; label = 'Python' },
  @{ key = 'jq'; label = 'jq' }, @{ key = 'claude'; label = 'Claude Code' }
)
foreach ($t in $toolRows) {
  $v = $F.($t.key)
  if ($v) { Row 'PASS' $t.label "installed ($v)" } else { Row 'NOTE' $t.label 'not installed yet: the installer adds it' }
}
if ($F.git -and -not $F.gitBash) { Row 'WARN' 'Git Bash' 'Git is installed but Git Bash was not found; Claude Code runs its scripts through it. Reinstall Git for Windows with its defaults.' }
elseif ($F.gitBash) { Row 'PASS' 'Git Bash' 'found' }

if ($F.claudeApp) { Row 'PASS' 'Claude app' 'installed' } else { Row 'NOTE' 'Claude app' 'not installed yet: the installer adds it' }
if ($F.chrome) { Row 'PASS' 'Chrome' 'installed' } else { Row 'NOTE' 'Chrome' 'not installed: get it at https://www.google.com/chrome' }

foreach ($h in $Hosts) {
  if ($F.network.$h) { Row 'PASS' $h 'reachable' }
  else { Row 'FAIL' $h 'cannot be reached: check the internet connection, or ask IT whether a firewall blocks it' }
}
if ($F.proxy) { Row 'NOTE' 'Proxy' 'a proxy is set on this PC; if a download stalls, tell the Supersuit team' }

# ---------- Verdict ----------

$fails = @($Rows | Where-Object { $_.status -eq 'FAIL' }).Count
$warns = @($Rows | Where-Object { $_.status -eq 'WARN' }).Count
$itBlocked = ($F.winget -eq 'denied') -or (-not $F.scriptsRun -and $managed)
if ($itBlocked) { $Verdict = 'Blocked by your company''s IT: send them the request below' }
elseif ($fails -gt 0) { $Verdict = "Not ready: $fails blocker" + $(if ($fails -eq 1) { '' } else { 's' }) }
elseif ($warns -gt 0) { $Verdict = "Ready, with $warns item" + $(if ($warns -eq 1) { '' } else { 's' }) + ' to note' }
else { $Verdict = 'Ready' }

$ItRequest = @'
I'm setting up Supersuit, an AI assistant that runs on Claude Code, on my PC. The installer needs Windows Package Manager (winget) and PowerShell scripts, and this PC's company policy blocks them.

Option A (preferred): allow winget (Microsoft.DesktopAppInstaller_8wekyb3d8bbwe) and PowerShell scripts to run for my user account. The installer uses winget for these official packages: Node.js LTS (OpenJS.NodeJS.LTS), Git for Windows (Git.Git), jq (jqlang.jq), Python 3.12 per-user (Python.Python.3.12) and Claude Code (Anthropic.ClaudeCode).

Option B: if winget has to stay blocked, please install those five on my PC and put them on my PATH, plus these for the rest of the setup: 1Password and its Chrome extension, Tailscale, Wispr Flow, and Chrome Remote Desktop Host (Google.ChromeRemoteDesktopHost).

Either way, please confirm that node, git, python and claude can run from my user profile (for example C:\Users\<me>\.local\bin and %LOCALAPPDATA%\Programs\Python), and that nothing blocks Git Bash (bash.exe), which Claude Code runs its scripts through. I do not need admin rights, only these allowed.
'@
$showRequest = ($F.winget -eq 'denied') -or (-not $F.scriptsRun)

# ---------- Print, report, save ----------

Write-Host ''
foreach ($r in $Rows) { Write-Host ('  {0,-5} {1,-18} {2}' -f $r.status, $r.label, $r.detail) }
Write-Host ''
Write-Host '=================================================='
Write-Output "VERDICT: $Verdict"
Write-Host '=================================================='
if ($showRequest) {
  Write-Host ''
  Write-Host 'Send this to your IT, copied whole:'
  Write-Host ''
  Write-Output $ItRequest
}

$day = Get-Date -Format 'yyyy-MM-dd'
$lines = @('SUPERSUIT READINESS REPORT', "Date: $day", "System: $($F.os) ($($F.arch))", 'Checked by: preflight.ps1', "VERDICT: $Verdict", '')
foreach ($r in $Rows) { $lines += ('{0}: {1}  {2}' -f $r.label, $r.status, $r.detail) }
if ($showRequest) { $lines += ''; $lines += 'IT REQUEST'; $lines += $ItRequest }
$report = $lines -join "`r`n"

Write-Host ''
Write-Host '----- SUPERSUIT READINESS REPORT (copy from here) -----'
Write-Output $report
Write-Host '----- end of report -----'

$homeDir = $env:USERPROFILE
if (-not $homeDir) { $homeDir = $HOME }
$dest = Join-Path $homeDir 'Downloads'
if (-not (Test-Path $dest)) { $dest = $homeDir }
$file = Join-Path $dest "supersuit-readiness-$day.txt"
try { Set-Content -Path $file -Value $report -Encoding UTF8 -ErrorAction Stop; $saved = $true } catch { $saved = $false }
$copied = $false
if (-not $env:SUPERSUIT_NO_CLIPBOARD) {
  try { Set-Clipboard -Value $report -ErrorAction Stop; $copied = $true } catch {}
}

Write-Host ''
$where = @()
if ($copied) { $where += 'copied to your clipboard' }
if ($saved) { $where += "saved as supersuit-readiness-$day.txt in your Downloads folder" }
if ($where.Count) { Write-Host ('The report is ' + ($where -join ', and ') + '.') }
Write-Output 'Paste this into your email to the Supersuit team, or attach the file.'
# A Windows command read above (dsregcmd, a missing tool) can leave a nonzero exit code behind; the check
# itself succeeded, so a caller (and the windows-smoke step, which failed on it) reads 0.
$global:LASTEXITCODE = 0

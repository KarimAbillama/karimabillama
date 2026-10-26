<#
  EDGE SCM - install or update on Windows Server.

  Run once as Administrator from the folder you unzipped (for example C:\EDGE-SCM):
      powershell -ExecutionPolicy Bypass -File .\install.ps1

  Before running: install PostgreSQL 16 for Windows (official installer from postgresql.org,
  keep the default port 5432 and remember the password you choose for the "postgres" user).

  What it does (and what it changes on the server):
    1. Creates the "edge" database and database user (first install only).
    2. Writes config\edge.env with the settings (readable by Administrators and SYSTEM only).
    3. Uses your HTTPS certificate (.pfx), or creates a self-signed one for testing.
    4. Creates or upgrades the database tables.
    5. Installs the "EDGE SCM" Windows service (starts automatically, restarts if it stops).
    6. Opens the chosen port in Windows Firewall.
    7. Schedules a daily database backup at 01:30.
  Running it again (for example after copying a new version over this folder) keeps your
  settings and data, upgrades the database and restarts the service.
#>
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Config = Join-Path $Root "config"
$EnvFile = Join-Path $Config "edge.env"
$Node = Join-Path $Root "node\node.exe"
$ServiceDir = Join-Path $Root "service"
$ServiceExe = Join-Path $ServiceDir "edge-scm.exe"

function Say($text) { Write-Host $text -ForegroundColor Cyan }
function Fail($text) { Write-Host "`n$text" -ForegroundColor Red; exit 1 }
function NewSecret([int]$length) {
  $chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789".ToCharArray()
  $bytes = New-Object byte[] $length
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  -join ($bytes | ForEach-Object { $chars[$_ % $chars.Length] })
}
function FindPgBin {
  $dirs = Get-ChildItem "C:\Program Files\PostgreSQL" -Directory -ErrorAction SilentlyContinue | Sort-Object { [int]($_.Name -replace '\D', '') } -Descending
  foreach ($d in $dirs) { $p = Join-Path $d.FullName "bin"; if (Test-Path (Join-Path $p "psql.exe")) { return $p } }
  return $null
}

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { Fail "Please run this from PowerShell opened with 'Run as administrator'." }
if (-not (Test-Path $Node)) { Fail "node\node.exe is missing. Unzip the whole package first, then run install.ps1 from inside the folder." }

$PgBin = FindPgBin
if (-not $PgBin) { Fail "PostgreSQL was not found. Install PostgreSQL 16 for Windows (postgresql.org/download/windows), then run this again." }
Say "PostgreSQL found: $PgBin"
New-Item -ItemType Directory -Force -Path $Config, (Join-Path $Root "logs"), (Join-Path $Root "backups") | Out-Null

if (-not (Test-Path $EnvFile)) {
  Say "`nFirst install: setting up the database."
  $sec = Read-Host "Password of the PostgreSQL 'postgres' user (chosen when you installed PostgreSQL)" -AsSecureString
  $env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
  $psql = Join-Path $PgBin "psql.exe"
  $exists = & $psql -U postgres -h localhost -p 5432 -tAc "select 1 from pg_roles where rolname = 'edge'"
  if ($LASTEXITCODE -ne 0) { Fail "Could not connect to PostgreSQL as 'postgres'. Check the password and that the PostgreSQL service is running." }
  if ($exists -eq "1") { Fail "A database user 'edge' already exists but config\edge.env is missing. Restore edge.env from your backup, or ask IT to remove the old 'edge' database user." }
  $dbPassword = NewSecret 32
  & $psql -U postgres -h localhost -p 5432 -v ON_ERROR_STOP=1 -c "CREATE ROLE edge LOGIN PASSWORD '$dbPassword'" | Out-Null
  & $psql -U postgres -h localhost -p 5432 -v ON_ERROR_STOP=1 -c "CREATE DATABASE edge OWNER edge ENCODING 'UTF8' TEMPLATE template0" | Out-Null
  if ($LASTEXITCODE -ne 0) { Fail "Could not create the database." }
  Remove-Item Env:\PGPASSWORD

  $org = Read-Host "Company name to show in the system [EDGE SCM Building Contracting]"
  if (-not $org) { $org = "EDGE SCM Building Contracting" }

  Say "`nHTTPS certificate (keeps passwords and data encrypted between phones/PCs and the server)."
  $pfx = Read-Host "Full path of your company's certificate .pfx file (press Enter to create a self-signed one for testing)"
  if ($pfx) {
    if (-not (Test-Path $pfx)) { Fail "Certificate file not found: $pfx" }
    $pfxPass = Read-Host "Password of the .pfx file (Enter if none)"
    Copy-Item $pfx (Join-Path $Config "edge.pfx") -Force
  } else {
    $pfxPass = NewSecret 24
    $names = @($env:COMPUTERNAME)
    try { $fqdn = [System.Net.Dns]::GetHostEntry($env:COMPUTERNAME).HostName; if ($fqdn -and $fqdn -ne $env:COMPUTERNAME) { $names += $fqdn } } catch {}
    $cert = New-SelfSignedCertificate -DnsName $names -CertStoreLocation "Cert:\LocalMachine\My" -NotAfter (Get-Date).AddYears(3) -FriendlyName "EDGE SCM (self-signed)"
    Export-PfxCertificate -Cert $cert -FilePath (Join-Path $Config "edge.pfx") -Password (ConvertTo-SecureString $pfxPass -AsPlainText -Force) | Out-Null
    Write-Host "Created a self-signed certificate for: $($names -join ', '). Browsers will warn until you install a proper certificate." -ForegroundColor Yellow
  }
  $port = Read-Host "Port for the system [443]"
  if (-not $port) { $port = "443" }

  @(
    "# EDGE SCM settings. Keep this file private: it contains the database password.",
    "NODE_ENV=production",
    "DATABASE_URL=postgres://edge:$dbPassword@localhost:5432/edge",
    "PORT=$port",
    "HOST=0.0.0.0",
    "TLS_PFX_FILE=$(Join-Path $Config 'edge.pfx')",
    "TLS_PFX_PASSPHRASE=`"$($pfxPass -replace '"', '')`"",
    "WEB_DIR=$(Join-Path $Root 'app\web')",
    "ORG_NAME=`"$($org -replace '"', '')`"",
    "SESSION_TTL_HOURS=12",
    "BACKUP_DIR=$(Join-Path $Root 'backups')",
    "BACKUP_KEEP_DAYS=30",
    "# Optional second copy of every backup, e.g. a NAS share: BACKUP_COPY_TO=\\nas\EDGE-Backups",
    "BACKUP_COPY_TO="
  ) | Set-Content -Path $EnvFile -Encoding ASCII
  icacls $Config /inheritance:r /grant:r "Administrators:(OI)(CI)F" "SYSTEM:(OI)(CI)F" | Out-Null
  Say "Settings saved to $EnvFile"
} else {
  Say "Existing settings found ($EnvFile): keeping them."
}

$port = ((Get-Content $EnvFile | Where-Object { $_ -match '^PORT=' }) -replace '^PORT=', '').Trim()

# Stop the service during an update so files are not in use.
if (Test-Path $ServiceExe) { & $ServiceExe stop 2>$null | Out-Null; Start-Sleep -Seconds 3 }

Say "`nCreating / upgrading the database tables..."
& $Node "--env-file=$EnvFile" (Join-Path $Root "app\edge-cli.mjs") migrate
if ($LASTEXITCODE -ne 0) { Fail "Database upgrade failed. Nothing else was changed. Send the message above to support." }

Say "`nInstalling the Windows service..."
New-Item -ItemType Directory -Force -Path $ServiceDir | Out-Null
Copy-Item (Join-Path $Root "tools\winsw.exe") $ServiceExe -Force
Copy-Item (Join-Path $Root "tools\winsw.exe.config") (Join-Path $ServiceDir "edge-scm.exe.config") -Force
$xml = @"
<service>
  <id>edge-scm</id>
  <name>EDGE SCM</name>
  <description>EDGE SCM construction system (web app and API). Installed from $Root</description>
  <executable>$Node</executable>
  <arguments>--env-file="$EnvFile" "$(Join-Path $Root 'app\start-server.mjs')"</arguments>
  <workingdirectory>$Root</workingdirectory>
  <logpath>$(Join-Path $Root 'logs')</logpath>
  <logmode>roll</logmode>
  <onfailure action="restart" delay="10 sec"/>
  <onfailure action="restart" delay="30 sec"/>
  <startmode>Automatic</startmode>
</service>
"@
Set-Content -Path (Join-Path $ServiceDir "edge-scm.xml") -Value $xml -Encoding UTF8
if (-not (Get-Service -Name "edge-scm" -ErrorAction SilentlyContinue)) { & $ServiceExe install | Out-Null }
& $ServiceExe start | Out-Null
Start-Sleep -Seconds 5
$svc = Get-Service -Name "edge-scm" -ErrorAction SilentlyContinue
if (-not $svc -or $svc.Status -ne "Running") { Fail "The service did not start. Look at the newest file in $(Join-Path $Root 'logs') and send it to support." }

if (-not (Get-NetFirewallRule -DisplayName "EDGE SCM" -ErrorAction SilentlyContinue)) {
  New-NetFirewallRule -DisplayName "EDGE SCM" -Direction Inbound -Protocol TCP -LocalPort $port -Action Allow -Profile Domain,Private | Out-Null
  Say "Firewall: port $port opened for the office network (Domain and Private profiles)."
}

$taskAction = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$(Join-Path $Root 'backup.ps1')`""
$taskTrigger = New-ScheduledTaskTrigger -Daily -At "01:30"
Register-ScheduledTask -TaskName "EDGE SCM daily backup" -Action $taskAction -Trigger $taskTrigger -User "SYSTEM" -RunLevel Highest -Force | Out-Null
Say "Daily backup scheduled at 01:30 (Task Scheduler: 'EDGE SCM daily backup')."

$url = if ($port -eq "443") { "https://$($env:COMPUTERNAME)" } else { "https://$($env:COMPUTERNAME):$port" }
Write-Host "`nEDGE SCM is running: $url" -ForegroundColor Green
Write-Host @"

Next steps:
  1. Create the first administrator:
       .\edge.cmd create-admin you@yourcompany.ae "Your Name"
  2. Fill the CSV templates in templates\ (projects, companies, staff...), check them, then load them:
       .\edge.cmd import templates --dry-run
       .\edge.cmd import templates
  3. Open $url from a PC on the office network and sign in.
See README-SERVER.txt for site access (VPN), backups and updates.
"@

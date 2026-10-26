<#
  EDGE SCM - database backup. Runs every night from Task Scheduler (set up by install.ps1).
  You can also run it by hand:  powershell -ExecutionPolicy Bypass -File .\backup.ps1
  Writes backups\edge-YYYYMMDD-HHMM.dump plus a .sha256 checksum, keeps BACKUP_KEEP_DAYS days,
  and copies each backup to BACKUP_COPY_TO (e.g. a NAS share) when that is set in config\edge.env.
  Keep at least one copy away from this server.
#>
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$EnvFile = Join-Path $Root "config\edge.env"
$Log = Join-Path $Root "logs\backup.log"
function Log($t) { $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $t"; Add-Content -Path $Log -Value $line; Write-Host $line }

$cfg = @{}
foreach ($l in Get-Content $EnvFile) {
  if ($l -match '^\s*#' -or $l -notmatch '=') { continue }
  $k, $v = $l -split '=', 2
  $cfg[$k.Trim()] = $v.Trim().Trim('"')
}
$dir = if ($cfg["BACKUP_DIR"]) { $cfg["BACKUP_DIR"] } else { Join-Path $Root "backups" }
$keep = if ($cfg["BACKUP_KEEP_DAYS"]) { [int]$cfg["BACKUP_KEEP_DAYS"] } else { 30 }
New-Item -ItemType Directory -Force -Path $dir | Out-Null

$pgBin = Get-ChildItem "C:\Program Files\PostgreSQL" -Directory | Sort-Object { [int]($_.Name -replace '\D', '') } -Descending |
  ForEach-Object { Join-Path $_.FullName "bin" } | Where-Object { Test-Path (Join-Path $_ "pg_dump.exe") } | Select-Object -First 1
if (-not $pgBin) { Log "ERROR: pg_dump.exe not found"; exit 1 }

$file = Join-Path $dir ("edge-" + (Get-Date -Format "yyyyMMdd-HHmm") + ".dump")
& (Join-Path $pgBin "pg_dump.exe") "--dbname=$($cfg['DATABASE_URL'])" --format=custom --no-owner --no-privileges "--file=$file"
if ($LASTEXITCODE -ne 0) { Log "ERROR: pg_dump failed (exit $LASTEXITCODE)"; exit 1 }
$hash = (Get-FileHash -Algorithm SHA256 $file).Hash.ToLower()
Set-Content -Path "$file.sha256" -Value "$hash  $(Split-Path -Leaf $file)" -Encoding ASCII
Log "Backup written: $file ($([math]::Round((Get-Item $file).Length / 1MB, 1)) MB)"

if ($cfg["BACKUP_COPY_TO"]) {
  try { Copy-Item $file, "$file.sha256" -Destination $cfg["BACKUP_COPY_TO"] -Force; Log "Copied to $($cfg['BACKUP_COPY_TO'])" }
  catch { Log "WARNING: could not copy to $($cfg['BACKUP_COPY_TO']): $($_.Exception.Message)" }
}
Get-ChildItem $dir -Filter "edge-*.dump*" | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$keep) } | Remove-Item -Force

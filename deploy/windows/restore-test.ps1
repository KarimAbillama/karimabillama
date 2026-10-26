<#
  EDGE SCM - restore TEST. Restores a backup into a separate database (edge_restore_test) and runs
  integrity checks, WITHOUT touching the live system. Do this every month to prove backups work.
      powershell -ExecutionPolicy Bypass -File .\restore-test.ps1 -DumpFile .\backups\edge-20261026-0130.dump
  To recover the live system from a backup, follow "Disaster recovery" in README-SERVER.txt.
#>
param([Parameter(Mandatory = $true)][string]$DumpFile)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not (Test-Path $DumpFile)) { Write-Host "Backup file not found: $DumpFile" -ForegroundColor Red; exit 1 }
$sum = "$DumpFile.sha256"
if (Test-Path $sum) {
  $expected = ((Get-Content $sum) -split '\s+')[0]
  if ((Get-FileHash -Algorithm SHA256 $DumpFile).Hash.ToLower() -ne $expected) { Write-Host "Checksum does not match: the backup file is damaged." -ForegroundColor Red; exit 1 }
  Write-Host "Checksum OK."
}
$pgBin = Get-ChildItem "C:\Program Files\PostgreSQL" -Directory | Sort-Object { [int]($_.Name -replace '\D', '') } -Descending |
  ForEach-Object { Join-Path $_.FullName "bin" } | Where-Object { Test-Path (Join-Path $_ "pg_restore.exe") } | Select-Object -First 1
$sec = Read-Host "Password of the PostgreSQL 'postgres' user" -AsSecureString
$env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
$psql = Join-Path $pgBin "psql.exe"
& $psql -U postgres -h localhost -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS edge_restore_test" | Out-Null
& $psql -U postgres -h localhost -v ON_ERROR_STOP=1 -c "CREATE DATABASE edge_restore_test ENCODING 'UTF8' TEMPLATE template0" | Out-Null
& (Join-Path $pgBin "pg_restore.exe") -U postgres -h localhost --no-owner --dbname=edge_restore_test $DumpFile
if ($LASTEXITCODE -ne 0) { Write-Host "Restore reported errors (see above)." -ForegroundColor Red; exit 1 }
& $psql -U postgres -h localhost -d edge_restore_test -f (Join-Path $Root "tools\verify-restore.sql")
Remove-Item Env:\PGPASSWORD
Write-Host "`nRestore test finished. Check the results above, then you may drop the test database:" -ForegroundColor Green
Write-Host "  psql -U postgres -c `"DROP DATABASE edge_restore_test`""

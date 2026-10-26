<#
  EDGE SCM - remove the Windows service, firewall rule and backup task.
  The database, settings and backups are KEPT. Run as Administrator.
#>
$ErrorActionPreference = "Continue"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$ServiceExe = Join-Path $Root "service\edge-scm.exe"
if (Test-Path $ServiceExe) { & $ServiceExe stop; & $ServiceExe uninstall }
Remove-NetFirewallRule -DisplayName "EDGE SCM" -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName "EDGE SCM daily backup" -Confirm:$false -ErrorAction SilentlyContinue
Write-Host "EDGE SCM service removed. The database, config and backups folders were not touched."

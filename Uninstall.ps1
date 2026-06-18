<#
.SYNOPSIS
  Removes the ADO Command Center tray launchers (Desktop / Start Menu / Startup).
.DESCRIPTION
  Deletes the shortcuts created by Install.ps1. Does not touch node_modules,
  config.json, or the repo itself. If the tray app is running, Quit it from the
  tray menu first.
.EXAMPLE
  .\Uninstall.ps1
#>
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'

$name = 'ADO Command Center'
$paths = @(
  (Join-Path ([Environment]::GetFolderPath('Desktop'))  "$name.lnk"),
  (Join-Path ([Environment]::GetFolderPath('Programs')) "$name.lnk"),
  (Join-Path ([Environment]::GetFolderPath('Startup'))  "$name.lnk")
)

foreach ($p in $paths) {
  if (Test-Path $p) { Remove-Item $p -Force; Write-Host "  removed $p" -ForegroundColor Green }
}
Write-Host 'Launchers removed.' -ForegroundColor Green

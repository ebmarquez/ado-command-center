<#
.SYNOPSIS
  One-time setup for the ADO Command Center tray app (run from the repo).
.DESCRIPTION
  Prepares a cloned/copied repo for use on this machine:
    1. Restores Node dependencies (npm install).
    2. Creates launchers (Desktop + Start Menu, and a Startup shortcut so the
       tray starts at sign-in) that launch the tray with no console window via
       Launch-CommandCenter.vbs.

  Auto-start is ON by default (matching the in-app Settings toggle). Use
  -NoStartup to skip the Startup shortcut; you can still toggle "Start at login"
  later from the Settings (gear) panel.

  Re-runnable: overwrites shortcuts.

  Parameters:
    -NoDesktop      Skip the Desktop shortcut.
    -NoStartMenu    Skip the Start Menu shortcut.
    -NoStartup      Do not launch automatically at sign-in.
    -NoInstallDeps  Skip npm install (deps already present).
.EXAMPLE
  .\Install.ps1
.EXAMPLE
  .\Install.ps1 -NoStartup
#>
[CmdletBinding()]
param(
  [switch]$NoDesktop,
  [switch]$NoStartMenu,
  [switch]$NoStartup,
  [switch]$NoInstallDeps
)
$ErrorActionPreference = 'Stop'

$here    = $PSScriptRoot
$vbs     = Join-Path $here 'Launch-CommandCenter.vbs'
$icon    = Join-Path $here 'command-center.ico'
$trayJs  = Join-Path $here 'command-center-tray.js'
$wscript = Join-Path $env:WINDIR 'System32\wscript.exe'

# --- prerequisites ----------------------------------------------------------
if (-not (Test-Path $vbs))    { throw "Launcher not found: $vbs" }
if (-not (Test-Path $trayJs)) { throw "Tray host not found: $trayJs" }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js 18+ not found on PATH.' }

# AzureAuth is required to mint Azure DevOps tokens.
$azureAuthFound = `
  ($env:AZUREAUTH_PATH -and (Test-Path $env:AZUREAUTH_PATH)) -or `
  [bool](Get-Command azureauth -ErrorAction SilentlyContinue) -or `
  [bool](Get-ChildItem (Join-Path $env:LOCALAPPDATA 'Programs\AzureAuth') -Filter azureauth.exe -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1)
if (-not $azureAuthFound) { Write-Warning "AzureAuth was not found. Install it from https://aka.ms/AzureAuth (or set AZUREAUTH_PATH) before first use." }

# --- 1. dependencies --------------------------------------------------------
if (-not $NoInstallDeps) {
  Write-Host 'Installing Node dependencies (npm install)...' -ForegroundColor Cyan
  Push-Location $here
  try { & npm install --no-audit --no-fund | Out-Null; if ($LASTEXITCODE -ne 0) { throw "npm install failed ($LASTEXITCODE)." } }
  finally { Pop-Location }
}

# --- 2. shortcuts -----------------------------------------------------------
if (-not (Test-Path $icon)) { Write-Warning "Icon not found ($icon); shortcuts will use the default icon." }
$name        = 'ADO Command Center'
$desktopLnk  = Join-Path ([Environment]::GetFolderPath('Desktop')) "$name.lnk"
$startLnk    = Join-Path ([Environment]::GetFolderPath('Programs')) "$name.lnk"
$startupLnk  = Join-Path ([Environment]::GetFolderPath('Startup')) "$name.lnk"

function New-Lnk([string]$path) {
  $shell = New-Object -ComObject WScript.Shell
  $lnk = $shell.CreateShortcut($path)
  $lnk.TargetPath       = $wscript
  $lnk.Arguments        = '"' + $vbs + '"'
  $lnk.WorkingDirectory = $here
  $lnk.WindowStyle      = 1
  $lnk.Description       = 'ADO Command Center (tray app)'
  if (Test-Path $icon) { $lnk.IconLocation = "$icon,0" }
  $lnk.Save()
  Write-Host "  created $path" -ForegroundColor Green
}

Write-Host 'Creating launchers...' -ForegroundColor Cyan
if (-not $NoDesktop)   { New-Lnk $desktopLnk }
if (-not $NoStartMenu) { New-Lnk $startLnk }
if (-not $NoStartup)   { New-Lnk $startupLnk; Write-Host '  (will launch at sign-in — toggle later in Settings)' -ForegroundColor DarkGray }

Write-Host ''
Write-Host 'Setup complete.' -ForegroundColor Green
Write-Host '  Launch "ADO Command Center" from the Start Menu or Desktop.' -ForegroundColor Gray
Write-Host '  Tray menu: Open Board / Open Dashboard / Restart server / Quit.' -ForegroundColor Gray
Write-Host '  Toggle auto-start anytime from the Settings (gear) panel.' -ForegroundColor Gray

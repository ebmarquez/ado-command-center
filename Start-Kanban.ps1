<#
.SYNOPSIS
  Launches the ADO Command Center (Kanban board + analytics dashboard).
.DESCRIPTION
  Installs dependencies on first run, starts the local server, and opens the
  one-time launch link in your browser. On first launch you'll be guided through
  setup (sign in via AzureAuth, choose org/project/scope).
  Requires: Node.js 18+ and AzureAuth (https://aka.ms/AzureAuth).
.EXAMPLE
  .\Start-Kanban.ps1
.EXAMPLE
  .\Start-Kanban.ps1 -Restart
#>
[CmdletBinding()]
param(
  [int]$Port = 7421,
  [switch]$NoBrowser,
  [switch]$Restart
)
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "Node.js 18+ is required but was not found on PATH." }
# AzureAuth mints the Azure DevOps token (https://aka.ms/AzureAuth). Accept it on
# PATH, via AZUREAUTH_PATH, or from the default per-user install location.
$azureAuthFound = `
  ($env:AZUREAUTH_PATH -and (Test-Path $env:AZUREAUTH_PATH)) -or `
  [bool](Get-Command azureauth -ErrorAction SilentlyContinue) -or `
  [bool](Get-ChildItem (Join-Path $env:LOCALAPPDATA 'Programs\AzureAuth') -Filter azureauth.exe -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1)
if (-not $azureAuthFound) { throw "AzureAuth was not found. Install it from https://aka.ms/AzureAuth (or set AZUREAUTH_PATH)." }

# Install dependencies on first run.
if (-not (Test-Path (Join-Path $here 'node_modules'))) {
  Write-Host "Installing dependencies (first run)..." -ForegroundColor Cyan
  Push-Location $here
  try { npm install --no-fund --no-audit | Out-Null } finally { Pop-Location }
}

# If -Restart, stop whatever is listening on the port.
if ($Restart) {
  $conns = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  foreach ($c in $conns) {
    try { Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue; Write-Host "Stopped existing server (PID $($c.OwningProcess))." -ForegroundColor Yellow } catch {}
  }
  Start-Sleep -Seconds 1
}

# Detect an already-running instance (the launch link/token lives in its console).
$listening = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($listening) {
  Write-Host "A server is already listening on port $Port." -ForegroundColor Green
  Write-Host "Open the launch link printed in that server's terminal window." -ForegroundColor Gray
  Write-Host "(Use '.\Start-Kanban.ps1 -Restart' to restart it and print a fresh link.)" -ForegroundColor DarkGray
  return
}

Write-Host "Starting ADO Command Center on http://localhost:$Port ..." -ForegroundColor Cyan
if (-not $NoBrowser) {
  # The server prints a /auth?token=... link; open it once it's up by reading stdout.
  $env:ACC_OPEN_BROWSER = '1'
}
node (Join-Path $here 'kanban-server.js')

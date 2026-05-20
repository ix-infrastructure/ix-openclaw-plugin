[CmdletBinding()]
param(
    [switch]$SkipBuild,
    [switch]$Uninstall,
    [switch]$Help
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RepoDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$PluginId = "ix-memory"

if ($Help) {
    Write-Host @"
ix-openclaw-plugin installer

Usage:
  .\install.ps1
  .\install.ps1 -SkipBuild
  .\install.ps1 -Uninstall

Options:
  -SkipBuild   Skip npm install and npm run build
  -Uninstall   Remove the installed plugin and exit
  -Help        Show this message
"@
    exit 0
}

function Assert-Command {
    param(
        [string]$Name,
        [string]$Hint
    )

    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "$Name not found. $Hint"
    }
}

Assert-Command "openclaw" "Install OpenClaw first."

if ($Uninstall) {
    try {
        & openclaw plugins uninstall $PluginId | Out-Null
    } catch {
    }
    Write-Host "Uninstalled $PluginId"
    exit 0
}

Assert-Command "npm" "Install Node.js and npm first."

if (-not $SkipBuild) {
    Push-Location $RepoDir
    try {
        & npm install
        if ($LASTEXITCODE -ne 0) {
            throw "npm install failed"
        }

        & npm run build
        if ($LASTEXITCODE -ne 0) {
            throw "npm run build failed"
        }
    } finally {
        Pop-Location
    }
}

try {
    & openclaw plugins uninstall $PluginId | Out-Null
} catch {
}

& openclaw plugins install -l $RepoDir
if ($LASTEXITCODE -ne 0) {
    throw "openclaw plugins install failed"
}

Write-Host "Installed $PluginId from $RepoDir"

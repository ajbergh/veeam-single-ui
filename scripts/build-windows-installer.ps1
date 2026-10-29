<#
.SYNOPSIS
Builds the full offline Windows x64 executable installer.
.EXAMPLE
.\scripts\build-windows-installer.ps1
.EXAMPLE
.\scripts\build-windows-installer.ps1 -SkipInstall
#>
[CmdletBinding()]
param(
    [switch]$SkipInstall
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot

function Invoke-BuildCommand {
    param([string]$File, [string[]]$Arguments)
    if (-not (Test-Path -LiteralPath $File -PathType Leaf)) {
        throw "Build command was not found: $File"
    }
    $previousErrorActionPreference = $ErrorActionPreference
    try {
        # Windows PowerShell turns redirected native stderr into ErrorRecords.
        # Show the text without treating a warning as a terminating script error.
        $ErrorActionPreference = 'Continue'
        & $File @Arguments 2>&1 | ForEach-Object { Write-Host $_ }
        $commandExitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }
    if ($commandExitCode -ne 0) {
        throw "$File failed with exit code $commandExitCode."
    }
}

Push-Location -LiteralPath $projectRoot
try {
    $nodeCommand = (Get-Command node.exe -ErrorAction Stop).Source
    $npmCommand = (Get-Command npm.cmd -ErrorAction Stop).Source
    $nodeVersion = & $nodeCommand -p 'process.versions.node'
    if ($LASTEXITCODE -ne 0 -or [version]$nodeVersion -lt [version]'22.12.0') {
        throw 'Install Node.js 22.12 or newer with npm, then run this script again.'
    }

    if (-not $SkipInstall) {
        Invoke-BuildCommand -File $npmCommand -Arguments @('ci', '--include=dev')
    }
    Invoke-BuildCommand -File $npmCommand -Arguments @('run', 'desktop:build')
    Invoke-BuildCommand -File $npmCommand -Arguments @('run', 'desktop:stage')
    Invoke-BuildCommand -File $nodeCommand -Arguments @(
        (Join-Path $projectRoot 'node_modules/electron-builder/cli.js'),
        '--config', 'electron-builder.cjs', '--win', 'nsis', '--x64', '--publish', 'never'
    )

    $version = (Get-Content -LiteralPath package.json -Raw | ConvertFrom-Json).version
    $artifact = Join-Path $projectRoot "artifacts/windows/Open-Backup-UI-$version-Setup-x64.exe"
    if (-not (Test-Path -LiteralPath $artifact -PathType Leaf)) {
        throw "The build did not produce the expected installer: $artifact"
    }
    $hash = (Get-FileHash -LiteralPath $artifact -Algorithm SHA256).Hash.ToLowerInvariant()
    "$hash  $(Split-Path -Leaf $artifact)" | Set-Content -LiteralPath "$artifact.sha256" -Encoding ascii
    Write-Host "Windows installer: $artifact"
    Write-Host "SHA-256 checksum: $artifact.sha256"
}
finally {
    Pop-Location
}

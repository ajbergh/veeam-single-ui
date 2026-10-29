# Run with Windows PowerShell to cover its native stderr/redirection behavior.
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$nodeCommand = (Get-Command node.exe -ErrorAction Stop).Source
$temporaryRoot = Join-Path $projectRoot 'tmp'
$testDirectory = Join-Path $temporaryRoot "build script tests-$([guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $testDirectory -Force | Out-Null

try {
    $warningFile = Join-Path $testDirectory 'successful command with warning.cjs'
    $failureFile = Join-Path $testDirectory 'failed command.cjs'
    Set-Content -LiteralPath $warningFile -Encoding ascii -Value "process.stderr.write('build warning\n'); process.exit(0);"
    Set-Content -LiteralPath $failureFile -Encoding ascii -Value 'process.exit(7);'

    foreach ($scriptName in @('build-standalone.ps1', 'build-windows-installer.ps1')) {
        $tokens = $null
        $parseErrors = $null
        $scriptPath = Join-Path $projectRoot "scripts/$scriptName"
        $ast = [System.Management.Automation.Language.Parser]::ParseFile($scriptPath, [ref]$tokens, [ref]$parseErrors)
        if ($parseErrors.Count -gt 0) { throw ($parseErrors | Out-String) }
        $commandFunction = $ast.Find({
            param($node)
            $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Invoke-BuildCommand'
        }, $true)
        if ($null -eq $commandFunction) { throw "Missing build command wrapper in $scriptName" }
        # Load the actual wrapper without executing a production build.
        Invoke-Expression $commandFunction.Extent.Text

        Invoke-BuildCommand -File $nodeCommand -Arguments @($warningFile) 2>&1 | Out-Null
        if ($ErrorActionPreference -ne 'Stop') { throw 'Successful command changed the caller preference.' }

        $failureRejected = $false
        try { Invoke-BuildCommand -File $nodeCommand -Arguments @($failureFile) | Out-Null }
        catch {
            if ($_.Exception.Message -notlike '*exit code 7*') { throw }
            $failureRejected = $true
        }
        if (-not $failureRejected) { throw "Failed command was accepted by $scriptName" }
        if ($ErrorActionPreference -ne 'Stop') { throw 'Failed command changed the caller preference.' }

        $missingRejected = $false
        try { Invoke-BuildCommand -File (Join-Path $testDirectory 'missing.exe') -Arguments @() | Out-Null }
        catch {
            if ($_.Exception.Message -notlike '*Build command was not found*') { throw }
            $missingRejected = $true
        }
        if (-not $missingRejected) { throw "Missing command was accepted by $scriptName" }
        Write-Host "PASS: $scriptName - redirected warnings, nonzero exit, missing command, paths with spaces, preference restoration."
    }

    $originalPath = $env:Path
    Push-Location -LiteralPath $testDirectory
    try {
        $env:Path = Join-Path $env:SystemRoot 'System32'
        foreach ($scriptName in @('build-standalone.ps1', 'build-windows-installer.ps1')) {
            $prerequisiteRejected = $false
            try { & (Join-Path $projectRoot "scripts/$scriptName") -SkipInstall }
            catch {
                if ($_.Exception.Message -notlike '*node.exe*') { throw }
                $prerequisiteRejected = $true
            }
            if (-not $prerequisiteRejected) { throw "Missing Node.js was accepted by $scriptName" }
            if ((Get-Location).Path -ne $testDirectory) { throw "$scriptName did not restore the caller directory after failure." }
            Write-Host "PASS: $scriptName - prerequisite failure restores the caller directory."
        }
    }
    finally {
        $env:Path = $originalPath
        Pop-Location
    }
}
finally {
    $resolvedTestDirectory = [System.IO.Path]::GetFullPath($testDirectory)
    if ([System.IO.Path]::GetDirectoryName($resolvedTestDirectory) -ne [System.IO.Path]::GetFullPath($temporaryRoot)) {
        throw 'Refusing to remove a test directory outside the workspace tmp folder.'
    }
    Remove-Item -LiteralPath $resolvedTestDirectory -Recurse -Force
}

# Expected native failures leave LASTEXITCODE set even when they are caught.
# GitHub Actions forwards that value after dot-sourcing this script.
# Reach success only after every assertion and cleanup has completed.
exit 0

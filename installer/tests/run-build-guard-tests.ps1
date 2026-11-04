# Build guard: build-installer.ps1 must refuse a missing or unsafe -ApiBaseUrl before it builds anything.
$ErrorActionPreference = 'Stop'
$buildScript = Join-Path (Split-Path $PSScriptRoot -Parent) 'build-installer.ps1'
$powershellExe = (Get-Command powershell.exe -ErrorAction Stop).Source

function Invoke-BuildProbe([string[]]$Arguments) {
    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $output = & $powershellExe -NoProfile -ExecutionPolicy Bypass -File $buildScript @Arguments 2>&1
        $exitCode = $LASTEXITCODE
    } finally { $ErrorActionPreference = $previousPreference }
    return [pscustomobject]@{ ExitCode = $exitCode; Output = ($output -join [Environment]::NewLine) }
}

# Missing parameter: PowerShell itself refuses (mandatory), non-interactive host cannot prompt.
$missing = Invoke-BuildProbe @('-NonInteractive')
if ($missing.ExitCode -eq 0) { throw "Expected build without -ApiBaseUrl to fail. Output: $($missing.Output)" }

foreach ($url in @('http://example.com', 'https://example.com/path', 'https://user@example.com', 'ftp://example.com')) {
    $probe = Invoke-BuildProbe @('-ApiBaseUrl', $url)
    if ($probe.ExitCode -eq 0 -or $probe.Output -notmatch 'must be an https origin') { throw "Expected rejection of $url. Output: $($probe.Output)" }
}
# Loopback http is only allowed together with -TestBuild.
$loopback = Invoke-BuildProbe @('-ApiBaseUrl', 'http://127.0.0.1:4000')
if ($loopback.ExitCode -eq 0 -or $loopback.Output -notmatch 'must be an https origin') { throw "Expected loopback http without -TestBuild to be rejected. Output: $($loopback.Output)" }

Write-Output 'Build guard tests passed.'

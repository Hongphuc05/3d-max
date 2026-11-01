# Test installer\Get-PreviewSeed.ps1 voi may chu gia (node). Khong can mang that.
$ErrorActionPreference = 'Stop'
$script = Join-Path $PSScriptRoot '..\..\installer\Get-PreviewSeed.ps1'
$server = Join-Path $PSScriptRoot 'seed-server.mjs'
$work = Join-Path ([IO.Path]::GetTempPath()) ("seed-tests-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work | Out-Null
$failures = 0
function Check($ok, $name) { if ($ok) { Write-Host "PASS $name" } else { Write-Host "FAIL $name"; $script:failures++ } }

function Start-Mock([string]$mode) {
    $info = New-Object Diagnostics.ProcessStartInfo 'node', "`"$server`" $mode"
    $info.RedirectStandardOutput = $true; $info.UseShellExecute = $false; $info.CreateNoWindow = $true
    $process = [Diagnostics.Process]::Start($info)
    $line = $process.StandardOutput.ReadLine()
    if ($line -notmatch '^PORT (\d+)$') { $process.Kill(); throw "mock server did not start: $line" }
    return @{ Process = $process; Url = "http://127.0.0.1:$($Matches[1])" }
}
function Run-Seed([string]$mode, [string]$name) {
    $mock = Start-Mock $mode
    $out = Join-Path $work $name
    try {
        $ok = $true
        try { & $script -ApiBaseUrl $mock.Url -OutputDirectory $out -AllowInsecureLoopback | Out-Null } catch { $ok = $false }
        return @{ Ok = $ok; Out = $out }
    } finally { $mock.Process.Kill(); $mock.Process.Dispose() }
}

try {
    $good = Run-Seed 'ok' 'ok'
    $files = @(Get-ChildItem $good.Out -Filter *.webp -ErrorAction SilentlyContinue)
    Check ($good.Ok -and $files.Count -eq 5 -and (Test-Path (Join-Path $good.Out 'seed-manifest.json'))) 'seed: 5 verified previews and a seed-manifest.json'
    $manifest = Get-Content (Join-Path $good.Out 'seed-manifest.json') -Raw | ConvertFrom-Json
    Check ($manifest.version -eq 1 -and $manifest.catalogVersion -eq 7 -and @($manifest.files).Count -eq 5) 'seed-manifest lists every file with version 1 and the catalog version'
    $sha = [Security.Cryptography.SHA256]::Create()
    $allMatch = $true
    foreach ($f in $files) { $hash = ([BitConverter]::ToString($sha.ComputeHash([IO.File]::ReadAllBytes($f.FullName))) -replace '-', '').ToLowerInvariant(); if ($f.BaseName -ne $hash) { $allMatch = $false } }
    Check $allMatch 'every file is named after its own sha256'

    $dup = Run-Seed 'duplicate' 'dup'
    Check ($dup.Ok -and @(Get-ChildItem $dup.Out -Filter *.webp).Count -eq 5) 'a preview listed twice is downloaded once'

    foreach ($case in 'missing', 'corrupt', 'badsize', 'badurl', 'traversal', 'empty', 'redirect') {
        $r = Run-Seed $case $case
        Check (-not $r.Ok) "'$case' makes the build fail"
        Check (-not (Test-Path (Join-Path $r.Out 'seed-manifest.json'))) "'$case' leaves no seed-manifest.json (an incomplete seed is never announced as complete)"
    }

    $threw = $false
    try { & $script -ApiBaseUrl 'http://127.0.0.1:1' -OutputDirectory (Join-Path $work 'x') | Out-Null } catch { $threw = $true }
    Check $threw 'plain http is refused without -AllowInsecureLoopback'
    foreach ($bad in 'https://example.test/path', 'https://user@example.test/', 'https://example.test/?x=1', 'ftp://example.test/') {
        $threw = $false
        try { & $script -ApiBaseUrl $bad -OutputDirectory (Join-Path $work 'x') | Out-Null } catch { $threw = $true }
        Check $threw "'$bad' is not an acceptable API origin"
    }
} finally { Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue }
if ($failures -gt 0) { throw "$failures seed test(s) failed" }
Write-Host 'Seed tests passed'

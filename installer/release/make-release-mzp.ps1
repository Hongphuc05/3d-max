# Package the reusable stage once. The public artifact is itself a ZIP-based MZP.
param([string]$Version = '1.4.4', [string]$StageDirectory = (Join-Path (Split-Path $PSScriptRoot -Parent) 'stage'))
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
if ($Version -notmatch '^\d+\.\d+\.\d+([-.][A-Za-z0-9.-]+)?$') { throw 'Invalid release version.' }
$stage = [IO.Path]::GetFullPath($StageDirectory)
$plugin = Join-Path $stage 'Platform'
foreach ($relative in @('MaxWebViewHost.dll', 'ThirdPartyNotices.txt', 'plugin-config.json', 'PlatformBridge.ms', 'app\index.html', 'runtimes')) {
    if (-not (Test-Path -LiteralPath (Join-Path $plugin $relative))) { throw "Incomplete stage: $relative" }
}
$template = Join-Path (Split-Path $PSScriptRoot -Parent) 'mzp'
$out = Join-Path $PSScriptRoot 'out'
New-Item -ItemType Directory -Force -Path $out | Out-Null
$package = Join-Path $out ('mzp-' + [Guid]::NewGuid().ToString('N'))
try {
    New-Item -ItemType Directory -Path $package | Out-Null
    Copy-Item -LiteralPath $plugin -Destination (Join-Path $package 'payload') -Recurse
    foreach ($name in @('mzp.run', 'install.ms', 'PlatformLoader.ms')) {
        Copy-Item -LiteralPath (Join-Path $template $name) -Destination $package
    }
    Copy-Item -LiteralPath (Join-Path $stage 'usermacros\Platform-OpenPanel.mcr') -Destination $package
    Copy-Item -LiteralPath (Join-Path $stage 'Startup\Platform-Agent.ms') -Destination $package
    Copy-Item -LiteralPath (Join-Path $template 'icons') -Destination (Join-Path $package 'icons') -Recurse
    # The running plugin reads its own version from payload\version.txt (update check), so the label is part of the payload.
    [IO.File]::WriteAllText((Join-Path $package 'payload\version.txt'), $Version)
    # Digest includes file paths and bytes (incl. version.txt), not timestamps.
    $manifest = Get-ChildItem -LiteralPath (Join-Path $package 'payload') -File -Recurse | Sort-Object FullName | ForEach-Object {
        $relative = $_.FullName.Substring((Join-Path $package 'payload').Length).Replace('\', '/')
        $relative + ' ' + (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash
    }
    $hash = [Security.Cryptography.SHA256]::Create()
    try { $digest = [BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes(($manifest -join "`n")))).Replace('-', '').ToLowerInvariant() }
    finally { $hash.Dispose() }
    [IO.File]::WriteAllText((Join-Path $package 'payload-id.txt'), ('v-' + $digest))
    [IO.File]::WriteAllText((Join-Path $package 'version.txt'), $Version)
    $temporary = Join-Path $out ('3dsmood-library-' + [Guid]::NewGuid().ToString('N') + '.tmp')
    # Write portable entry names explicitly; .NET Framework can otherwise emit backslashes.
    Add-Type -AssemblyName System.IO.Compression
    $packageArchive = [IO.Compression.ZipFile]::Open($temporary, [IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach ($sourceFile in Get-ChildItem -LiteralPath $package -File -Recurse | Sort-Object FullName) {
            $entryName = $sourceFile.FullName.Substring($package.Length + 1).Replace('\', '/')
            $null = [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($packageArchive, $sourceFile.FullName, $entryName, [IO.Compression.CompressionLevel]::Optimal)
        }
    } finally { $packageArchive.Dispose() }
    $artifact = Join-Path $out '3dsmood-library.mzp'
    & (Join-Path (Split-Path $PSScriptRoot -Parent) 'tests\verify-mzp.ps1') -PackagePath $temporary
    Move-Item -LiteralPath $temporary -Destination $artifact -Force
    Write-Host ("MZP: {0} ({1:N2} MiB), SHA256 {2}" -f $artifact, ((Get-Item -LiteralPath $artifact).Length / 1MB), (Get-FileHash -LiteralPath $artifact -Algorithm SHA256).Hash)
} finally {
    # Only delete the fresh package directory created above, inside this script's out folder.
    if ([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($package)) -ne [IO.Path]::GetFullPath($out)) { throw 'Unsafe package cleanup path.' }
    if (Test-Path -LiteralPath $package) { Remove-Item -LiteralPath $package -Recurse -Force }
    if ($temporary -and (Test-Path -LiteralPath $temporary)) { Remove-Item -LiteralPath $temporary -Force }
}

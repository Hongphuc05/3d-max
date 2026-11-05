# Exercise the artifact validator against a real build and corrupted packages.
param([string]$PackagePath = (Join-Path (Split-Path $PSScriptRoot -Parent) 'release\out\3dsmood-library.mzp'))
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$verify = Join-Path $PSScriptRoot 'verify-mzp.ps1'
& $verify -PackagePath $PackagePath
$temporary = Join-Path ([IO.Path]::GetTempPath()) ('3dsmood-mzp-test-' + [Guid]::NewGuid().ToString('N') + '.mzp')
try {
    foreach ($fault in @('missing', 'traversal', 'duplicate-runtime', 'call-chain', 'backslash', 'undefined-backup')) {
        Copy-Item -LiteralPath $PackagePath -Destination $temporary -Force
        $archive = [IO.Compression.ZipFile]::Open($temporary, [IO.Compression.ZipArchiveMode]::Update)
        try {
            if ($fault -eq 'missing') { $archive.GetEntry('mzp.run').Delete() }
            elseif ($fault -eq 'traversal') { $null = $archive.CreateEntry('../escape.dll') }
            elseif ($fault -eq 'call-chain') {
                $entry = $archive.GetEntry('install.ms')
                $entry.Delete()
                $entry = $archive.CreateEntry('install.ms')
                $writer = New-Object IO.StreamWriter($entry.Open())
                try { $writer.Write('local broken = value.GetName().Name') } finally { $writer.Dispose() }
            }
            elseif ($fault -eq 'undefined-backup') {
                $entry = $archive.GetEntry('install.ms')
                $entry.Delete()
                $entry = $archive.CreateEntry('install.ms')
                $writer = New-Object IO.StreamWriter($entry.Open())
                try { $writer.Write('ioFile.Replace pending pointer undefined') } finally { $writer.Dispose() }
            }
            elseif ($fault -eq 'backslash') { $null = $archive.CreateEntry('payload\unexpected.dll') }
            else { $null = $archive.CreateEntry('extra/MaxWebViewHost.dll') }
        } finally { $archive.Dispose() }
        $rejected = $false
        try { & $verify -PackagePath $temporary } catch { $rejected = $true }
        if (-not $rejected) { throw "Validator accepted $fault package." }
        Write-Host "PASS MZP rejects $fault"
    }
} finally {
    if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }
}

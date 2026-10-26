param([Parameter(Mandatory=$true)][string]$PackageDirectory)
$ErrorActionPreference = 'Stop'
$packagePath = (Resolve-Path -LiteralPath $PackageDirectory).Path
$runner = Join-Path ([IO.Path]::GetTempPath()) ('3dsmood-package-runner-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $runner | Out-Null
try {
    $csc = & "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe" -latest -products * -requires Microsoft.Component.MSBuild -find MSBuild\**\Bin\Roslyn\csc.exe | Select-Object -First 1
    if (-not $csc) { throw 'Roslyn compiler not found.' }
    $exe = Join-Path $runner 'PackageSmokeTests.exe'
    & $csc /nologo /target:exe /platform:x64 /reference:System.IO.Compression.dll /reference:System.IO.Compression.FileSystem.dll /out:$exe (Join-Path $PSScriptRoot 'PackageSmokeTests.cs')
    if ($LASTEXITCODE -ne 0) { throw 'Package smoke test compilation failed.' }
    & $exe $packagePath (Join-Path $PSScriptRoot 'fixtures\Rar.rar') (Join-Path $PSScriptRoot 'fixtures\7Zip.LZMA.7z')
    if ($LASTEXITCODE -ne 0) { throw 'Deployed package cannot extract supported model archives.' }
}
finally {
    $resolvedRunner = [IO.Path]::GetFullPath($runner)
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if (-not $resolvedRunner.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -or (Split-Path $resolvedRunner -Leaf) -notlike '3dsmood-package-runner-*') { throw 'Unsafe runner cleanup path.' }
    Remove-Item -LiteralPath $resolvedRunner -Recurse -Force
}

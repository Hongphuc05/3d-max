$ErrorActionPreference = 'Stop'
$source = Join-Path $PSScriptRoot '..\MaxWebViewHost\MaxWebViewHost'
$output = Join-Path $PSScriptRoot 'bin\V3RoutesTests.exe'
New-Item -ItemType Directory -Path (Split-Path $output) -Force | Out-Null
$csc = & (Join-Path $PSScriptRoot 'find-csc.ps1')
& $csc /nologo /langversion:latest /target:exe /platform:x64 /out:$output (Join-Path $PSScriptRoot 'V3RoutesTests.cs') (Join-Path $source 'V3Routes.cs')
if ($LASTEXITCODE -ne 0) { throw 'V3 routes test compilation failed' }
& $output
if ($LASTEXITCODE -ne 0) { throw 'V3 routes tests failed' }

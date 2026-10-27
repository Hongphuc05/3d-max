$ErrorActionPreference = 'Stop'
$outDir = Join-Path $PSScriptRoot 'bin'
New-Item -ItemType Directory -Path $outDir -Force | Out-Null
$csc = 'C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\MSBuild\Current\Bin\Roslyn\csc.exe'
$output = Join-Path $outDir 'OfflineLicenseTests.exe'
& $csc /nologo /langversion:latest /target:exe /platform:x64 /out:"$output" /reference:System.Security.dll /reference:System.Web.Extensions.dll (Join-Path $PSScriptRoot 'OfflineLicenseTests.cs') (Join-Path $PSScriptRoot '..\MaxWebViewHost\MaxWebViewHost\OfflineLicenseService.cs')
if ($LASTEXITCODE -ne 0) { throw 'Offline license test compilation failed' }
& $output
if ($LASTEXITCODE -ne 0) { throw 'Offline license tests failed' }
& node --test (Join-Path $PSScriptRoot '..\..\tools\license-owner\owner-native.test.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Owner/native signature interoperability tests failed' }

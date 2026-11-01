$ErrorActionPreference = 'Stop'
$source = Join-Path $PSScriptRoot '..\MaxWebViewHost\MaxWebViewHost'
$output = Join-Path $PSScriptRoot 'bin\StaticCatalogTests.exe'
New-Item -ItemType Directory -Path (Split-Path $output) -Force | Out-Null
$csc = & (Join-Path $PSScriptRoot 'find-csc.ps1')
& $csc /nologo /target:exe /out:$output /reference:System.Net.Http.dll /reference:System.Web.Extensions.dll (Join-Path $PSScriptRoot 'StaticCatalogTests.cs') (Join-Path $source 'SecureHttpTransport.cs') (Join-Path $source 'StaticCatalogService.cs') (Join-Path $source 'GoogleDriveDownloader.cs')
if ($LASTEXITCODE -ne 0) { throw 'Static catalog test compilation failed' }
& $output
if ($LASTEXITCODE -ne 0) { throw 'Static catalog tests failed' }

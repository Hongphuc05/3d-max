$ErrorActionPreference = 'Stop'
$source = Join-Path $PSScriptRoot '..\MaxWebViewHost\MaxWebViewHost'
$output = Join-Path $PSScriptRoot 'bin\PreviewCacheTests.exe'
New-Item -ItemType Directory -Path (Split-Path $output) -Force | Out-Null
$csc = & (Join-Path $PSScriptRoot 'find-csc.ps1')
& $csc /nologo /langversion:latest /target:exe /platform:x64 /out:$output /reference:System.Net.Http.dll /reference:System.Web.Extensions.dll `
    (Join-Path $PSScriptRoot 'PreviewCacheTests.cs') (Join-Path $source 'BackendApi.cs') (Join-Path $source 'CatalogCacheService.cs') (Join-Path $source 'PreviewCacheService.cs')
if ($LASTEXITCODE -ne 0) { throw 'Preview cache test compilation failed' }
& $output
if ($LASTEXITCODE -ne 0) { throw 'Preview cache tests failed' }

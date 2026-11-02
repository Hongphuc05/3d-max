$ErrorActionPreference = 'Stop'
$source = Join-Path $PSScriptRoot '..\MaxWebViewHost\MaxWebViewHost'
$output = Join-Path $PSScriptRoot 'bin\OrdersClientTests.exe'
New-Item -ItemType Directory -Path (Split-Path $output) -Force | Out-Null
$csc = & (Join-Path $PSScriptRoot 'find-csc.ps1')
& $csc /nologo /langversion:latest /target:exe /platform:x64 /out:$output /reference:System.Net.Http.dll /reference:System.Web.Extensions.dll `
    (Join-Path $PSScriptRoot 'OrdersClientTests.cs') (Join-Path $source 'BackendApi.cs') (Join-Path $source 'OrdersClient.cs') (Join-Path $source 'V3Routes.cs')
if ($LASTEXITCODE -ne 0) { throw 'Orders client test compilation failed' }
& $output
if ($LASTEXITCODE -ne 0) { throw 'Orders client tests failed' }

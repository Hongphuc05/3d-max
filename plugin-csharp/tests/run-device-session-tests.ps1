$ErrorActionPreference = 'Stop'
$source = Join-Path $PSScriptRoot '..\MaxWebViewHost\MaxWebViewHost'
$output = Join-Path $PSScriptRoot 'bin\DeviceSessionTests.exe'
New-Item -ItemType Directory -Path (Split-Path $output) -Force | Out-Null
$csc = & (Join-Path $PSScriptRoot 'find-csc.ps1')
& $csc /nologo /langversion:latest /target:exe /platform:x64 /out:$output /reference:System.Net.Http.dll /reference:System.Web.Extensions.dll /reference:System.Security.dll `
    (Join-Path $PSScriptRoot 'DeviceSessionTests.cs') (Join-Path $source 'SecureHttpTransport.cs') (Join-Path $source 'BackendApi.cs') `
    (Join-Path $source 'DeviceSessionService.cs') (Join-Path $source 'DeviceIdentityService.cs')
if ($LASTEXITCODE -ne 0) { throw 'Device session test compilation failed' }
& $output
if ($LASTEXITCODE -ne 0) { throw 'Device session tests failed' }

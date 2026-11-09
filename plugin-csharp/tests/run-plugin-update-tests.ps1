$ErrorActionPreference = 'Stop'
$source = Join-Path $PSScriptRoot '..\MaxWebViewHost\MaxWebViewHost'
$output = Join-Path $PSScriptRoot 'bin\PluginUpdateTests.exe'
New-Item -ItemType Directory -Path (Split-Path $output) -Force | Out-Null
$csc = & (Join-Path $PSScriptRoot 'find-csc.ps1')
& $csc /nologo /langversion:latest /target:exe /platform:x64 /out:$output /reference:System.Net.Http.dll /reference:System.Web.Extensions.dll /reference:System.IO.Compression.dll /reference:System.IO.Compression.FileSystem.dll `
    (Join-Path $PSScriptRoot 'PluginUpdateTests.cs') (Join-Path $source 'BackendApi.cs') (Join-Path $source 'PluginUpdate.cs')
if ($LASTEXITCODE -ne 0) { throw 'Plugin update test compilation failed' }
& $output
if ($LASTEXITCODE -ne 0) { throw 'Plugin update tests failed' }

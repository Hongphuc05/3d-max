$ErrorActionPreference = 'Stop'
$source = Join-Path $PSScriptRoot '..\MaxWebViewHost\MaxWebViewHost'
$outDir = Join-Path $PSScriptRoot 'bin'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$csc = & (Join-Path $PSScriptRoot 'find-csc.ps1')
& $csc /nologo /langversion:latest /target:exe /platform:x64 /out:"$outDir\TexturePathResolverTests.exe" /reference:System.Security.dll /reference:System.Web.Extensions.dll /reference:System.Net.Http.dll (Join-Path $PSScriptRoot 'TexturePathResolverTests.cs') (Join-Path $source 'DownloadedLibrary.cs') (Join-Path $source 'BackendApi.cs')
if ($LASTEXITCODE -ne 0) { throw 'Texture resolver compilation failed' }
& "$outDir\TexturePathResolverTests.exe"
if ($LASTEXITCODE -ne 0) { throw 'Texture resolver tests failed' }

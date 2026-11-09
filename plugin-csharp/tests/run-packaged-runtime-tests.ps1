$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$outDir = Join-Path $PSScriptRoot 'bin'
New-Item -ItemType Directory -Path $outDir -Force | Out-Null
$csc = & (Join-Path $PSScriptRoot 'find-csc.ps1')
$sourceRoot = Join-Path $repo 'plugin-csharp\MaxWebViewHost\MaxWebViewHost'
$core = Join-Path $repo 'plugin-csharp\MaxWebViewHost\packages\Microsoft.Web.WebView2.1.0.4191.47\lib\net462\Microsoft.Web.WebView2.Core.dll'
Copy-Item -LiteralPath $core -Destination $outDir -Force
$sources = @('PackagedAppRuntime.cs','PluginConfiguration.cs','SessionCookieStore.cs','SecureHttpTransport.cs','V3Library.cs','PluginUpdate.cs','V3Routes.cs','OrdersClient.cs','BackendApi.cs','DeviceSessionService.cs','DeviceIdentityService.cs','CatalogCacheService.cs','PreviewCacheService.cs','CatalogUpdateWatcher.cs','BackendModelDownloader.cs','DownloadedLibrary.cs','ArchivePackage.cs') | ForEach-Object { Join-Path $sourceRoot $_ }
& $csc /nologo /langversion:latest /target:exe /platform:x64 /out:"$outDir\PackagedRuntimeTests.exe" /reference:System.Security.dll /reference:System.Web.Extensions.dll /reference:System.Net.Http.dll /reference:System.IO.Compression.dll /reference:System.IO.Compression.FileSystem.dll /reference:"$core" (Join-Path $PSScriptRoot 'PackagedRuntimeTests.cs') $sources /reference:"$(Join-Path $repo 'plugin-csharp/MaxWebViewHost/packages/SharpCompress.0.50.7/lib/net48/SharpCompress.dll')"
if ($LASTEXITCODE -ne 0) { throw 'Packaged runtime tests compilation failed' }
& "$outDir\PackagedRuntimeTests.exe"
if ($LASTEXITCODE -ne 0) { throw 'Packaged runtime tests failed' }

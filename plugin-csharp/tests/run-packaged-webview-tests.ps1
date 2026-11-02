$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$outDir = Join-Path $PSScriptRoot 'bin'
New-Item -ItemType Directory -Path $outDir -Force | Out-Null
$csc = & (Join-Path $PSScriptRoot 'find-csc.ps1')
$sourceRoot = Join-Path $repo 'plugin-csharp\MaxWebViewHost\MaxWebViewHost'
$package = Join-Path $repo 'plugin-csharp\MaxWebViewHost\packages\Microsoft.Web.WebView2.1.0.4191.47'
$core = Join-Path $package 'lib\net462\Microsoft.Web.WebView2.Core.dll'
$winforms = Join-Path $package 'lib\net462\Microsoft.Web.WebView2.WinForms.dll'
Copy-Item -LiteralPath $core,$winforms -Destination $outDir -Force
Copy-Item -LiteralPath (Join-Path $package 'runtimes\win-x64\native\WebView2Loader.dll') -Destination $outDir -Force
$sources = @('PackagedAppRuntime.cs','PluginConfiguration.cs','SessionCookieStore.cs','SecureHttpTransport.cs','V3Library.cs','V3Routes.cs','BackendApi.cs','DeviceSessionService.cs','DeviceIdentityService.cs','CatalogCacheService.cs','PreviewCacheService.cs','CatalogUpdateWatcher.cs','BackendModelDownloader.cs') | ForEach-Object { Join-Path $sourceRoot $_ }
& $csc /nologo /langversion:latest /target:exe /platform:x64 /out:"$outDir\PackagedWebViewTests.exe" /reference:System.Security.dll /reference:System.Web.Extensions.dll /reference:System.Net.Http.dll /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:"$core" /reference:"$winforms" (Join-Path $PSScriptRoot 'PackagedWebViewTests.cs') $sources
if ($LASTEXITCODE -ne 0) { throw 'Packaged WebView tests compilation failed' }
& "$outDir\PackagedWebViewTests.exe"
if ($LASTEXITCODE -ne 0) { throw 'Packaged WebView tests failed' }

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
& $csc /nologo /langversion:latest /target:exe /platform:x64 /out:"$outDir\WebViewTransportTests.exe" /reference:System.Security.dll /reference:System.Web.Extensions.dll /reference:System.Net.Http.dll /reference:System.Drawing.dll /reference:System.Windows.Forms.dll /reference:"$core" /reference:"$winforms" (Join-Path $PSScriptRoot 'WebViewTransportTests.cs') (Join-Path $sourceRoot 'DeviceIdentityService.cs') (Join-Path $sourceRoot 'PluginConfiguration.cs') (Join-Path $sourceRoot 'SecureHttpTransport.cs') (Join-Path $sourceRoot 'V3Library.cs') (Join-Path $sourceRoot 'V3Routes.cs') (Join-Path $sourceRoot 'OrdersClient.cs') (Join-Path $sourceRoot 'BackendApi.cs') (Join-Path $sourceRoot 'DeviceSessionService.cs') (Join-Path $sourceRoot 'CatalogCacheService.cs') (Join-Path $sourceRoot 'PreviewCacheService.cs') (Join-Path $sourceRoot 'CatalogUpdateWatcher.cs') (Join-Path $sourceRoot 'BackendModelDownloader.cs') (Join-Path $sourceRoot 'ModelCacheService.cs') (Join-Path $sourceRoot 'PackagedAppRuntime.cs') (Join-Path $sourceRoot 'SessionCookieStore.cs') (Join-Path $sourceRoot 'BridgePolicy.cs') (Join-Path $sourceRoot 'MachineCode.cs') (Join-Path $sourceRoot 'MaxWebViewForm.cs') (Join-Path $sourceRoot 'ImportTargetSelection.cs') (Join-Path $sourceRoot 'PlatformAgent.cs') (Join-Path $sourceRoot 'ArchivePackage.cs') /reference:"$(Join-Path $repo 'plugin-csharp/MaxWebViewHost/packages/SharpCompress.0.50.7/lib/net48/SharpCompress.dll')"
if ($LASTEXITCODE -ne 0) { throw 'WebView transport test compilation failed' }
& "$outDir\WebViewTransportTests.exe"
if ($LASTEXITCODE -ne 0) { throw 'WebView transport tests failed' }

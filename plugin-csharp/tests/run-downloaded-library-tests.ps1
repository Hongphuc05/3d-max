$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$sourceRoot = Join-Path $repo 'plugin-csharp\MaxWebViewHost\MaxWebViewHost'
$outDir = Join-Path $PSScriptRoot 'bin'
New-Item -ItemType Directory -Path $outDir -Force | Out-Null
$packages = Join-Path $repo 'plugin-csharp\MaxWebViewHost\packages'
$csc = & (Join-Path $PSScriptRoot 'find-csc.ps1')
$sharp = Join-Path $packages 'SharpCompress.0.50.7\lib\net48\SharpCompress.dll'
$sources = @('V3Library.cs','PluginUpdate.cs','DownloadedLibrary.cs','PluginConfiguration.cs','SecureHttpTransport.cs','V3Routes.cs','OrdersClient.cs','BackendApi.cs','DeviceSessionService.cs','DeviceIdentityService.cs','CatalogCacheService.cs','PreviewCacheService.cs','CatalogUpdateWatcher.cs','BackendModelDownloader.cs','ArchivePackage.cs','BridgePolicy.cs') | ForEach-Object { Join-Path $sourceRoot $_ }
& $csc /nologo /langversion:latest /target:exe /platform:x64 /out:"$outDir\DownloadedLibraryTests.exe" /reference:System.Security.dll /reference:System.Web.Extensions.dll /reference:System.Net.Http.dll /reference:System.IO.Compression.dll /reference:System.IO.Compression.FileSystem.dll /reference:System.IO.Compression.dll /reference:"$sharp" (Join-Path $PSScriptRoot 'DownloadedLibraryTests.cs') $sources
if ($LASTEXITCODE -ne 0) { throw 'Downloaded library test compilation failed' }
$runtime = @('SharpCompress.0.50.7\lib\net48\SharpCompress.dll', 'Microsoft.Bcl.AsyncInterfaces.8.0.0\lib\net462\Microsoft.Bcl.AsyncInterfaces.dll', 'System.Buffers.4.6.1\lib\net462\System.Buffers.dll', 'System.Memory.4.6.3\lib\net462\System.Memory.dll', 'System.Numerics.Vectors.4.6.1\lib\net462\System.Numerics.Vectors.dll', 'System.Runtime.CompilerServices.Unsafe.6.1.2\lib\net462\System.Runtime.CompilerServices.Unsafe.dll', 'System.Text.Encoding.CodePages.8.0.0\lib\net462\System.Text.Encoding.CodePages.dll', 'System.Threading.Tasks.Extensions.4.5.4\lib\net461\System.Threading.Tasks.Extensions.dll')
foreach ($dll in $runtime) { Copy-Item -LiteralPath (Join-Path $packages $dll) -Destination $outDir -Force }
& "$outDir\DownloadedLibraryTests.exe"
if ($LASTEXITCODE -ne 0) { throw 'Downloaded library tests failed' }

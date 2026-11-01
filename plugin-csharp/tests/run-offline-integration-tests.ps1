param([switch]$WebView)
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$outDir = Join-Path $PSScriptRoot 'bin'
New-Item -ItemType Directory -Path $outDir -Force | Out-Null
$csc = & (Join-Path $PSScriptRoot 'find-csc.ps1')
$sourceRoot = Join-Path $repo 'plugin-csharp\MaxWebViewHost\MaxWebViewHost'
$sources = @('PluginConfiguration.cs', 'BridgePolicy.cs', 'SecureHttpTransport.cs') | ForEach-Object { Join-Path $sourceRoot $_ }
$extra = @()
if ($WebView) {
    $outDir = Join-Path $outDir 'offline-webview'
    New-Item -ItemType Directory -Path $outDir -Force | Out-Null
    $packageRoot = Join-Path $repo 'plugin-csharp\MaxWebViewHost\packages'
    $webPackage = Join-Path $packageRoot 'Microsoft.Web.WebView2.1.0.4191.47'
    $core = Join-Path $webPackage 'lib\net462\Microsoft.Web.WebView2.Core.dll'
    $forms = Join-Path $webPackage 'lib\net462\Microsoft.Web.WebView2.WinForms.dll'
    Copy-Item -LiteralPath $core, $forms -Destination $outDir -Force
    Copy-Item -LiteralPath (Join-Path $webPackage 'runtimes\win-x64\native\WebView2Loader.dll') -Destination $outDir -Force
    $archive = Join-Path $packageRoot 'SharpCompress.0.50.7\lib\net48\SharpCompress.dll'
    Copy-Item -LiteralPath $archive -Destination $outDir -Force
    $sources = @(Get-ChildItem -LiteralPath $sourceRoot -Filter '*.cs' | ForEach-Object FullName)
    $extra = @('/define:WEBVIEW', '/reference:System.Net.Http.dll', '/reference:System.Drawing.dll', '/reference:System.Windows.Forms.dll', "/reference:$core", "/reference:$forms", "/reference:$archive")
}
& $csc /nologo /langversion:latest /target:exe /platform:x64 /out:"$outDir\OfflineIntegrationTests.exe" /reference:System.Security.dll /reference:System.Web.Extensions.dll /reference:System.Net.Http.dll (Join-Path $PSScriptRoot 'OfflineIntegrationTests.cs') $sources $extra
if ($LASTEXITCODE -ne 0) { throw 'Offline integration test compilation failed' }
& "$outDir\OfflineIntegrationTests.exe"
if ($LASTEXITCODE -ne 0) { throw 'Offline integration tests failed' }

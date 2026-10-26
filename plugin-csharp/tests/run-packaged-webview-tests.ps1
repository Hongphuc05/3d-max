$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$outDir = Join-Path $PSScriptRoot 'bin'
New-Item -ItemType Directory -Path $outDir -Force | Out-Null
$csc = 'C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\MSBuild\Current\Bin\Roslyn\csc.exe'
$sourceRoot = Join-Path $repo 'plugin-csharp\MaxWebViewHost\MaxWebViewHost'
$package = Join-Path $repo 'plugin-csharp\MaxWebViewHost\packages\Microsoft.Web.WebView2.1.0.4191.47'
$core = Join-Path $package 'lib\net462\Microsoft.Web.WebView2.Core.dll'
$winforms = Join-Path $package 'lib\net462\Microsoft.Web.WebView2.WinForms.dll'
Copy-Item -LiteralPath $core,$winforms -Destination $outDir -Force
Copy-Item -LiteralPath (Join-Path $package 'runtimes\win-x64\native\WebView2Loader.dll') -Destination $outDir -Force
$sources = @('PackagedAppRuntime.cs','PluginConfiguration.cs','SessionCookieStore.cs') | ForEach-Object { Join-Path $sourceRoot $_ }
& $csc /nologo /langversion:latest /target:exe /platform:x64 /out:"$outDir\PackagedWebViewTests.exe" /reference:System.Security.dll /reference:System.Web.Extensions.dll /reference:System.Net.Http.dll /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:"$core" /reference:"$winforms" (Join-Path $PSScriptRoot 'PackagedWebViewTests.cs') $sources
if ($LASTEXITCODE -ne 0) { throw 'Packaged WebView tests compilation failed' }
& "$outDir\PackagedWebViewTests.exe"
if ($LASTEXITCODE -ne 0) { throw 'Packaged WebView tests failed' }

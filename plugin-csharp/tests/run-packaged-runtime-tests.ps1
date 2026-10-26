$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$outDir = Join-Path $PSScriptRoot 'bin'
New-Item -ItemType Directory -Path $outDir -Force | Out-Null
$csc = 'C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\MSBuild\Current\Bin\Roslyn\csc.exe'
$sourceRoot = Join-Path $repo 'plugin-csharp\MaxWebViewHost\MaxWebViewHost'
$core = Join-Path $repo 'plugin-csharp\MaxWebViewHost\packages\Microsoft.Web.WebView2.1.0.4191.47\lib\net462\Microsoft.Web.WebView2.Core.dll'
Copy-Item -LiteralPath $core -Destination $outDir -Force
$sources = @('PackagedAppRuntime.cs','PluginConfiguration.cs','SessionCookieStore.cs') | ForEach-Object { Join-Path $sourceRoot $_ }
& $csc /nologo /langversion:latest /target:exe /platform:x64 /out:"$outDir\PackagedRuntimeTests.exe" /reference:System.Security.dll /reference:System.Web.Extensions.dll /reference:System.Net.Http.dll /reference:"$core" (Join-Path $PSScriptRoot 'PackagedRuntimeTests.cs') $sources
if ($LASTEXITCODE -ne 0) { throw 'Packaged runtime tests compilation failed' }
& "$outDir\PackagedRuntimeTests.exe"
if ($LASTEXITCODE -ne 0) { throw 'Packaged runtime tests failed' }

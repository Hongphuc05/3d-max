$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$sourceRoot = Join-Path $repo 'plugin-csharp\MaxWebViewHost\MaxWebViewHost'
$packages = Join-Path $repo 'plugin-csharp\MaxWebViewHost\packages'
$out = Join-Path $PSScriptRoot 'bin\import-pipeline'
New-Item -ItemType Directory -Path $out -Force | Out-Null
$csc = & (Join-Path $PSScriptRoot 'find-csc.ps1')
$web = Join-Path $packages 'Microsoft.Web.WebView2.1.0.4191.47'
$core = Join-Path $web 'lib\net462\Microsoft.Web.WebView2.Core.dll'
$forms = Join-Path $web 'lib\net462\Microsoft.Web.WebView2.WinForms.dll'
$sharp = Join-Path $packages 'SharpCompress.0.50.7\lib\net48\SharpCompress.dll'
Copy-Item -LiteralPath $core,$forms,(Join-Path $web 'runtimes\win-x64\native\WebView2Loader.dll') -Destination $out -Force
$runtime = @('SharpCompress.0.50.7\lib\net48\SharpCompress.dll', 'Microsoft.Bcl.AsyncInterfaces.8.0.0\lib\net462\Microsoft.Bcl.AsyncInterfaces.dll', 'System.Buffers.4.6.1\lib\net462\System.Buffers.dll', 'System.Memory.4.6.3\lib\net462\System.Memory.dll', 'System.Numerics.Vectors.4.6.1\lib\net462\System.Numerics.Vectors.dll', 'System.Runtime.CompilerServices.Unsafe.6.1.2\lib\net462\System.Runtime.CompilerServices.Unsafe.dll', 'System.Text.Encoding.CodePages.8.0.0\lib\net462\System.Text.Encoding.CodePages.dll', 'System.Threading.Tasks.Extensions.4.5.4\lib\net461\System.Threading.Tasks.Extensions.dll')
foreach ($dll in $runtime) { Copy-Item -LiteralPath (Join-Path $packages $dll) -Destination $out -Force }
$sources = @(Get-ChildItem -LiteralPath $sourceRoot -Filter '*.cs' | ForEach-Object FullName)
& $csc /nologo /langversion:latest /target:exe /platform:x64 /out:"$out\ImportPipelineTests.exe" /reference:System.Security.dll /reference:System.Web.Extensions.dll /reference:System.Net.Http.dll /reference:System.Drawing.dll /reference:System.Windows.Forms.dll /reference:System.IO.Compression.dll /reference:"$core" /reference:"$forms" /reference:"$sharp" (Join-Path $PSScriptRoot 'ImportPipelineTests.cs') $sources
if ($LASTEXITCODE -ne 0) { throw 'Import pipeline tests compilation failed' }
& "$out\ImportPipelineTests.exe"
if ($LASTEXITCODE -ne 0) { throw 'Import pipeline tests failed' }

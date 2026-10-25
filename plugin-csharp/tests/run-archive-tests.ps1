$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$sourceRoot = Join-Path $repo 'plugin-csharp\MaxWebViewHost\MaxWebViewHost'
$outDir = Join-Path $PSScriptRoot 'bin'
New-Item -ItemType Directory -Path $outDir -Force | Out-Null
$packages = Join-Path $repo 'plugin-csharp\MaxWebViewHost\packages'
$csc = 'C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\MSBuild\Current\Bin\Roslyn\csc.exe'
$sharp = Join-Path $packages 'SharpCompress.0.50.7\lib\net48\SharpCompress.dll'
& $csc /nologo /langversion:latest /target:exe /platform:x64 /out:"$outDir\ArchiveSecurityTests.exe" /reference:System.IO.Compression.dll /reference:"$sharp" (Join-Path $PSScriptRoot 'ArchiveSecurityTests.cs') (Join-Path $sourceRoot 'ArchivePackage.cs')
if ($LASTEXITCODE -ne 0) { throw 'Archive security test compilation failed' }
$runtime = @('SharpCompress.0.50.7\lib\net48\SharpCompress.dll', 'Microsoft.Bcl.AsyncInterfaces.8.0.0\lib\net462\Microsoft.Bcl.AsyncInterfaces.dll', 'System.Buffers.4.6.1\lib\net462\System.Buffers.dll', 'System.Memory.4.6.3\lib\net462\System.Memory.dll', 'System.Numerics.Vectors.4.6.1\lib\net462\System.Numerics.Vectors.dll', 'System.Runtime.CompilerServices.Unsafe.6.1.2\lib\net462\System.Runtime.CompilerServices.Unsafe.dll', 'System.Text.Encoding.CodePages.8.0.0\lib\net462\System.Text.Encoding.CodePages.dll', 'System.Threading.Tasks.Extensions.4.5.4\lib\net461\System.Threading.Tasks.Extensions.dll')
foreach ($dll in $runtime) { Copy-Item -LiteralPath (Join-Path $packages $dll) -Destination $outDir -Force }
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'fixtures') -Destination $outDir -Recurse -Force
& "$outDir\ArchiveSecurityTests.exe"
if ($LASTEXITCODE -ne 0) { throw 'Archive security tests failed' }

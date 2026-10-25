$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$outDir = Join-Path $PSScriptRoot 'bin'
New-Item -ItemType Directory -Path $outDir -Force | Out-Null
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$sourceRoot = Join-Path $repo 'plugin-csharp\MaxWebViewHost\MaxWebViewHost'
& $csc /nologo /target:exe /platform:x64 /out:"$outDir\NativeSecurityTests.exe" /reference:System.Security.dll /reference:System.Web.Extensions.dll (Join-Path $PSScriptRoot 'NativeSecurityTests.cs') (Join-Path $sourceRoot 'DeviceIdentityService.cs') (Join-Path $sourceRoot 'BridgePolicy.cs')
if ($LASTEXITCODE -ne 0) { throw 'Native security test compilation failed' }
& "$outDir\NativeSecurityTests.exe"
if ($LASTEXITCODE -ne 0) { throw 'Native security tests failed' }
node (Join-Path $PSScriptRoot 'verify-native-proof.mjs') (Join-Path $outDir 'native-proof.json')
if ($LASTEXITCODE -ne 0) { throw 'Cross-runtime native proof verification failed' }

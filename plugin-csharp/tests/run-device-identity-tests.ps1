param([switch]$VerifyExistingProductionIdentity)
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$outDir = Join-Path $PSScriptRoot 'bin'
New-Item -ItemType Directory -Path $outDir -Force | Out-Null
$csc = 'C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\MSBuild\Current\Bin\Roslyn\csc.exe'
$output = Join-Path $outDir 'DeviceIdentityPersistenceTests.exe'
& $csc /nologo /langversion:latest /target:exe /platform:x64 /out:"$output" /reference:System.Security.dll /reference:System.Web.Extensions.dll (Join-Path $PSScriptRoot 'DeviceIdentityPersistenceTests.cs') (Join-Path $repo 'plugin-csharp\MaxWebViewHost\MaxWebViewHost\DeviceIdentityService.cs')
if ($LASTEXITCODE -ne 0) { throw 'Device identity persistence test compilation failed' }
& $output
if ($LASTEXITCODE -ne 0) { throw 'Device identity persistence tests failed' }
if ($VerifyExistingProductionIdentity) {
    # This mode only opens the existing production identity and proves its private key.
    # It refuses to create a production identity when metadata is absent.
    & $output '--production-readonly'
    if ($LASTEXITCODE -ne 0) { throw 'Existing production identity proof failed' }
}

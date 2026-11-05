# Legacy EXE build. Public releases use build-mzp.ps1.
param([Parameter(Mandatory = $true)][string]$ApiBaseUrl, [switch]$TestBuild, [switch]$SkipDependencyRestore)
$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'build-stage.ps1') -ApiBaseUrl $ApiBaseUrl -TestBuild:$TestBuild -SkipDependencyRestore:$SkipDependencyRestore
$stage = Join-Path $PSScriptRoot 'stage'
$setup = Join-Path $PSScriptRoot 'Setup\Setup.csproj'
$msbuild = & "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe" -latest -products * -requires Microsoft.Component.MSBuild -find MSBuild\**\Bin\MSBuild.exe | Select-Object -First 1
$zip = Join-Path $PSScriptRoot 'Setup\payload.zip'
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip -Force
& $msbuild $setup /restore /t:Rebuild /p:Configuration=Release /v:minimal /nologo
if ($LASTEXITCODE -ne 0) { throw 'Installer build failed.' }
$out = Join-Path $PSScriptRoot 'PlatformSetup.exe'
if ($TestBuild) { $out = Join-Path $PSScriptRoot 'PlatformSetup-Test.exe' }
Copy-Item (Join-Path $PSScriptRoot 'Setup\bin\Release\net48\PlatformSetup.exe') $out -Force
Write-Host "Legacy EXE: $out"

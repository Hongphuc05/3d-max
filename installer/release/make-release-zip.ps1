# Dong goi installer\PlatformSetup.exe + huong dan thanh installer\release\out\3dsmood-library.zip
# Chay: powershell -ExecutionPolicy Bypass -File installer\release\make-release-zip.ps1
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$installer = Split-Path -Parent $here
$setup = Join-Path $installer 'PlatformSetup.exe'
$guide = Join-Path $here 'HUONG-DAN-CAI-DAT.txt'
$changelog = Join-Path $here 'CHANGELOG.txt'
if (-not (Test-Path $setup)) { throw "Thieu $setup - chay installer\build-installer.ps1 truoc." }
if (-not (Test-Path $guide)) { throw "Thieu $guide" }
$files = @($setup, $guide)
if (Test-Path $changelog) { $files += $changelog }
$out = Join-Path $here 'out'
New-Item -ItemType Directory -Force -Path $out | Out-Null
$zip = Join-Path $out '3dsmood-library.zip'
if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path $files -DestinationPath $zip
Write-Host ("OK: {0} ({1:N1} MB)" -f $zip, ((Get-Item $zip).Length / 1MB))

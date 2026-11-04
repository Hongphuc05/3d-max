# Dong goi 3dsmood-library.zip = PlatformSetup.exe + huong dan + thu muc cai thu cong.
# Chay (sau khi build-installer.ps1 xong, vi can installer\stage):
#   powershell -ExecutionPolicy Bypass -File installer\release\make-release-zip.ps1
# (comment khong dau: PowerShell 5.1 doc file khong BOM theo ANSI)
param(
    [string]$Version = '1.0.0'
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$installer = Split-Path -Parent $here
$setup = Join-Path $installer 'PlatformSetup.exe'
$stage = Join-Path $installer 'stage'
$utf8Bom = New-Object Text.UTF8Encoding($true)
foreach ($p in @($setup, (Join-Path $stage 'Platform'), (Join-Path $stage 'Startup'), (Join-Path $stage 'usermacros'))) {
    if (-not (Test-Path $p)) { throw "Thieu $p - chay installer\build-installer.ps1 truoc." }
}

$out = Join-Path $here 'out'
$pkg = Join-Path $out 'pkg'
if ((Split-Path $pkg -Parent) -ne $out -or (Split-Path $pkg -Leaf) -ne 'pkg') { throw 'Unsafe package path.' }
if (Test-Path -LiteralPath $pkg) { Remove-Item -LiteralPath $pkg -Recurse -Force }
New-Item -ItemType Directory -Force -Path $pkg | Out-Null

# 1. exe + hash
Copy-Item $setup $pkg
$sha = (Get-FileHash -Algorithm SHA256 -LiteralPath $setup).Hash

# 2. cai thu cong: cung anh xa voi installer\Setup\Program.cs (Platform, Startup -> scripts\; usermacros -> ENU\)
$enu = Join-Path $pkg 'Cai-thu-cong\ENU'
New-Item -ItemType Directory -Force -Path (Join-Path $enu 'scripts') | Out-Null
Copy-Item (Join-Path $stage 'Platform') (Join-Path $enu 'scripts\Platform') -Recurse
Copy-Item (Join-Path $stage 'Startup') (Join-Path $enu 'scripts\Startup') -Recurse
Copy-Item (Join-Path $stage 'usermacros') (Join-Path $enu 'usermacros') -Recurse

# 3. huong dan + thong tin phien ban (thay the {{...}})
$vars = @{ '{{VERSION}}' = $Version; '{{SHA256}}' = $sha; '{{DATE}}' = (Get-Date -Format 'yyyy-MM-dd') }
foreach ($name in @('HUONG-DAN-CAI-DAT.html', 'THONG-TIN-PHIEN-BAN.txt')) {
    $text = [IO.File]::ReadAllText((Join-Path $here $name), [Text.Encoding]::UTF8)
    foreach ($k in $vars.Keys) { $text = $text.Replace($k, $vars[$k]) }
    if ($text -match '\{\{[A-Z0-9]+\}\}') { throw "$name con placeholder chua thay: $($Matches[0])" }
    [IO.File]::WriteAllText((Join-Path $pkg $name), $text, $utf8Bom)
}
$images = Join-Path $here 'images'
if (Test-Path $images) { Copy-Item $images (Join-Path $pkg 'images') -Recurse }
else { Write-Warning 'Chua co installer\release\images\ - huong dan se hien khung chu thay cho anh.' }
$changelog = Join-Path $here 'CHANGELOG.txt'
if (Test-Path $changelog) { Copy-Item $changelog $pkg }

# 4. zip (ZipFile.CreateFromDirectory tren .NET 4.8 dung dau / trong ten entry)
$zip = Join-Path $out '3dsmood-library.zip'
if (Test-Path $zip) { Remove-Item $zip -Force }
[IO.Compression.ZipFile]::CreateFromDirectory($pkg, $zip)
Write-Host ("OK: {0} ({1:N1} MB)  version {2}  exe SHA256 {3}" -f $zip, ((Get-Item $zip).Length / 1MB), $Version, $sha)

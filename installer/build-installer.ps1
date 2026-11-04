# Build plugin + dong goi thanh PlatformSetup.exe.
# Chay: powershell -ExecutionPolicy Bypass -File installer\build-installer.ps1
# (comment khong dau: PowerShell 5.1 doc file khong BOM theo ANSI)
param(
    # https origin of the API (e.g. https://api.example.com). Required: the plugin downloads catalog, previews and models from it.
    [Parameter(Mandatory = $true)][string]$ApiBaseUrl,
    [switch]$TestBuild
)
$ErrorActionPreference = 'Stop'

$loopbackOk = $TestBuild -and $ApiBaseUrl -match '^http://(127\.0\.0\.1|localhost)(:\d+)?/?$'
if (-not $loopbackOk -and $ApiBaseUrl -notmatch '^https://[^/@?#\s]+/?$') { throw '-ApiBaseUrl must be an https origin without path.' }
$ApiBaseUrl = $ApiBaseUrl.TrimEnd('/') + '/'

$root  = Split-Path $PSScriptRoot -Parent
$proj  = Join-Path $root 'plugin-csharp\MaxWebViewHost\MaxWebViewHost\MaxWebViewHost.csproj'
$setup = Join-Path $PSScriptRoot 'Setup\Setup.csproj'
$stage = Join-Path $PSScriptRoot 'stage'
$out   = Join-Path $PSScriptRoot 'PlatformSetup.exe'
if ($TestBuild) { $out = Join-Path $PSScriptRoot 'PlatformSetup-Test.exe' }

# Build-time only. The client receives static assets and never needs Node/npm.
Write-Host '==> Build bundled app'
Push-Location (Join-Path $root 'apps\store-web')
try {
    & npm.cmd ci --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'Frontend dependency restore failed.' }
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' }
} finally { Pop-Location }

$msbuild = & "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe" `
    -latest -products * -requires Microsoft.Component.MSBuild -find MSBuild\**\Bin\MSBuild.exe |
    Select-Object -First 1
# -products *: khong co thi vswhere bo qua Build Tools (chi tim ban VS co IDE)
if (-not $msbuild) { throw "Khong tim thay MSBuild (can Visual Studio Build Tools)." }

# --- 1. plugin, Release x64 ---
# packages\ khong nam trong git nen phai restore (packages.config) truoc khi build
Write-Host "==> Restore NuGet (WebView2 + archive dependencies)"
& $msbuild $proj /t:Restore /p:RestorePackagesConfig=true /p:SolutionDir="$(Split-Path (Split-Path $proj))\" /v:minimal /nologo
if ($LASTEXITCODE -ne 0) { throw "Restore NuGet that bai." }

Write-Host "==> Build plugin (Release x64)"
& $msbuild $proj /t:Rebuild /p:Configuration=Release /p:PlatformTarget=x64 /v:minimal /nologo
if ($LASTEXITCODE -ne 0) { throw "Build plugin that bai." }
$bin = Join-Path $root 'plugin-csharp\MaxWebViewHost\MaxWebViewHost\bin\Release'

# --- 2. stage dung layout se nam trong thu muc user cua Max ---
Write-Host "==> Stage"
$resolvedStage = [IO.Path]::GetFullPath($stage)
if ((Split-Path $resolvedStage -Parent) -ne [IO.Path]::GetFullPath($PSScriptRoot) -or (Split-Path $resolvedStage -Leaf) -ne 'stage') { throw 'Unsafe installer staging path.' }
if (Test-Path -LiteralPath $resolvedStage) { Remove-Item -LiteralPath $resolvedStage -Recurse -Force }
$pdir = Join-Path $stage 'Platform'
New-Item -ItemType Directory -Path $pdir, (Join-Path $stage 'usermacros'), (Join-Path $stage 'Startup') -Force | Out-Null

# runtimes\ phai giu nguyen cau truc, thieu la WebView2 khong init duoc
Copy-Item (Join-Path $bin '*.dll') $pdir
Copy-Item -LiteralPath (Join-Path $bin 'ThirdPartyNotices.txt') -Destination $pdir
Copy-Item (Join-Path $bin 'runtimes') $pdir -Recurse
Copy-Item (Join-Path $root 'maxscript\PlatformBridge.ms') $pdir
Copy-Item (Join-Path $root 'apps\store-web\dist') (Join-Path $pdir 'app') -Recurse
# No bundled catalog or previews: on first run the plugin downloads everything from the API.
$configuration = @{ apiBaseUrl = $ApiBaseUrl }
if ($TestBuild -and $ApiBaseUrl -like 'http://*') { $configuration.allowLoopbackForTesting = $true }
[IO.File]::WriteAllText((Join-Path $pdir 'plugin-config.json'), ($configuration | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))
Copy-Item (Join-Path $root 'maxscript\usermacros\Platform-OpenPanel.mcr') (Join-Path $stage 'usermacros')
Copy-Item (Join-Path $root 'maxscript\startup\Platform-Agent.ms') (Join-Path $stage 'Startup')

# Exercise the staged host in an isolated CLR process, so missing transitive
# archive dependencies cannot be hidden by the developer/test output folder.
Write-Host "==> Verify staged archive runtime (ZIP/RAR/7z)"
& (Join-Path $root 'plugin-csharp\tests\run-package-tests.ps1') -PackageDirectory $pdir

# --- 3. zip -> nhung vao installer duoi dang embedded resource ---
Write-Host "==> Zip payload"
$zip = Join-Path $PSScriptRoot 'Setup\payload.zip'
if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip -Force

# --- 4. installer exe ---
Write-Host "==> Build installer"
& $msbuild $setup /restore /t:Rebuild /p:Configuration=Release /v:minimal /nologo
if ($LASTEXITCODE -ne 0) { throw "Build installer that bai." }

Copy-Item (Join-Path $PSScriptRoot 'Setup\bin\Release\net48\PlatformSetup.exe') $out -Force
Write-Host ("==> Xong: {0} ({1:N0} KB)" -f $out, ((Get-Item $out).Length / 1KB))

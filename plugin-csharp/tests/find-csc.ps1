# Tim csc.exe (Roslyn) cua MSBuild moi nhat: BuildTools hoac Visual Studio bat ky ban (2022, 18...).
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
$csc = $null
if (Test-Path $vswhere) {
    $csc = & $vswhere -latest -products * -requires Microsoft.Component.MSBuild -find 'MSBuild\**\Bin\Roslyn\csc.exe' | Select-Object -First 1
}
if (-not $csc) { throw 'Khong tim thay csc.exe (can Visual Studio hoac Build Tools co MSBuild).' }
$csc

$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$outDir = Join-Path $PSScriptRoot 'bin'
New-Item -ItemType Directory -Path $outDir -Force | Out-Null
$csc = 'C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\MSBuild\Current\Bin\Roslyn\csc.exe'
& $csc /nologo /target:exe /out:"$outDir\ImportTargetSelectionTests.exe" (Join-Path $PSScriptRoot 'ImportTargetSelectionTests.cs') (Join-Path $repo 'plugin-csharp\MaxWebViewHost\MaxWebViewHost\ImportTargetSelection.cs')
if ($LASTEXITCODE -ne 0) { throw 'Target selection test compilation failed' }
& "$outDir\ImportTargetSelectionTests.exe"
if ($LASTEXITCODE -ne 0) { throw 'Target selection tests failed' }

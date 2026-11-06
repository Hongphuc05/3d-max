param([string]$MaxBatch = 'C:\Program Files\Autodesk\3ds Max 2022\3dsmaxbatch.exe')
$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'run-texture-resolver-tests.ps1')
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$work = Join-Path $PSScriptRoot ('bin\texture-max-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work,(Join-Path $work 'startup'),(Join-Path $work 'macros') -Force | Out-Null
# Use a separate INI and empty user startup/macro folders. Do not touch running Max processes.
$userIni = Join-Path $env:LOCALAPPDATA 'Autodesk\3dsMax\2022 - 64bit\ENU\3dsmax.ini'
$configuration = Get-Content -LiteralPath $userIni -Raw
$configuration = $configuration -replace '(?m)^Additional Startup Scripts=.*$', ('Additional Startup Scripts=' + (Join-Path $work 'startup'))
$configuration = $configuration -replace '(?m)^Additional Macros=.*$', ('Additional Macros=' + (Join-Path $work 'macros'))
$ini = Join-Path $work '3dsmax.ini'
[IO.File]::WriteAllText($ini, $configuration)
$launcher = Join-Path $work 'run.ms'
[IO.File]::WriteAllText($launcher, ('maxOps.mxsCmdLineArgs = dictionary #name ''repo'':@"' + $repo + '" ''work'':@"' + $work + '"' + "`r`n" + 'fileIn @"' + (Join-Path $PSScriptRoot 'TextureRelinkMaxTests.ms') + '"'))
& $MaxBatch $launcher -i $ini -dm on -safescene on -listenerlog (Join-Path $work 'listener.log') -log (Join-Path $work 'max.log') 2>&1 | ForEach-Object { ([string]$_).Replace([string][char]0, '') }
$result = Join-Path $work 'result.txt'
if (-not (Test-Path -LiteralPath $result)) { throw "Max test did not produce a report. See $work" }
$text = Get-Content -LiteralPath $result -Raw
Write-Host $text
if ($text -match 'FAIL' -or $text -notmatch '(?m)^PASS\s*$') { throw "Max texture relink test failed. See $work" }
Write-Host "Max texture integration verified: $work"

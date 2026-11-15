$ErrorActionPreference = 'Stop'
$source = Join-Path $PSScriptRoot '..\MaxWebViewHost\MaxWebViewHost'
$output = Join-Path $PSScriptRoot 'bin\TaskbarIdentityTests.exe'
New-Item -ItemType Directory -Path (Split-Path $output) -Force | Out-Null
$csc = & (Join-Path $PSScriptRoot 'find-csc.ps1')
& $csc /nologo /langversion:latest /target:exe /platform:x64 /out:$output /reference:System.Windows.Forms.dll `
    (Join-Path $PSScriptRoot 'TaskbarIdentityTests.cs') (Join-Path $source 'TaskbarIdentity.cs')
if ($LASTEXITCODE -ne 0) { throw 'Taskbar identity test compilation failed' }
& $output
if ($LASTEXITCODE -ne 0) { throw 'Taskbar identity tests failed' }

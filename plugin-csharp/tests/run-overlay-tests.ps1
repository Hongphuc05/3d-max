$ErrorActionPreference = 'Stop'
$source = Join-Path $PSScriptRoot '..\MaxWebViewHost\MaxWebViewHost'
$output = Join-Path $PSScriptRoot 'bin\DragDropOverlayTests.exe'
New-Item -ItemType Directory -Path (Split-Path $output) -Force | Out-Null
$csc = & (Join-Path $PSScriptRoot 'find-csc.ps1')
& $csc /nologo /langversion:latest /target:exe /platform:x64 /out:$output /reference:System.Windows.Forms.dll /reference:System.Drawing.dll `
    (Join-Path $PSScriptRoot 'DragDropOverlayTests.cs') (Join-Path $source 'DragDropOverlay.cs')
if ($LASTEXITCODE -ne 0) { throw 'Drop overlay test compilation failed' }
& $output
if ($LASTEXITCODE -ne 0) { throw 'Drop overlay tests failed' }

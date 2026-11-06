# Build the single public download. No EXE or duplicate manual-install tree.
param(
    [Parameter(Mandatory = $true)][string]$ApiBaseUrl,
    [string]$Version = '1.3.3',
    [switch]$TestBuild,
    [switch]$SkipDependencyRestore
)
$ErrorActionPreference = 'Stop'
$stage = Join-Path (Join-Path $PSScriptRoot 'release\out') ('mzp-stage-' + [Guid]::NewGuid().ToString('N') + '\stage')
& (Join-Path $PSScriptRoot 'build-stage.ps1') -ApiBaseUrl $ApiBaseUrl -TestBuild:$TestBuild -SkipDependencyRestore:$SkipDependencyRestore -StageDirectory $stage
& (Join-Path $PSScriptRoot 'release\make-release-mzp.ps1') -Version $Version -StageDirectory $stage

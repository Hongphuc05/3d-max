$ErrorActionPreference = 'Stop'
$testRoot = Join-Path (Join-Path (Split-Path $PSScriptRoot -Parent) 'release\out') ('pointer-test-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testRoot -Force | Out-Null
$pointer = Join-Path $testRoot 'active.txt'
[IO.File]::WriteAllText($pointer, 'old-payload')
foreach ($value in @('new-payload', 'newest-payload')) {
    $pending = Join-Path $testRoot ('active-' + [Guid]::NewGuid().ToString('N') + '.tmp')
    $backup = $pending + '.bak'
    $before = [IO.File]::ReadAllText($pointer)
    [IO.File]::WriteAllText($pending, $value)
    [IO.File]::Replace($pending, $pointer, $backup)
    if ([IO.File]::ReadAllText($pointer) -ne $value -or [IO.File]::ReadAllText($backup) -ne $before -or [IO.File]::Exists($pending)) { throw 'Atomic pointer swap failed.' }
    [IO.File]::Delete($backup)
    Write-Host 'PASS existing pointer replaced atomically using three string arguments'
}
$firstPointer = Join-Path $testRoot 'first-active.txt'
$firstPending = Join-Path $testRoot 'first.tmp'
[IO.File]::WriteAllText($firstPending, 'first-payload')
[IO.File]::Move($firstPending, $firstPointer)
if ([IO.File]::ReadAllText($firstPointer) -ne 'first-payload') { throw 'Initial pointer install failed.' }
Write-Host 'PASS initial pointer install uses move'
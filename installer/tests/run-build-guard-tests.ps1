$ErrorActionPreference = 'Stop'
$buildScript = Join-Path (Split-Path $PSScriptRoot -Parent) 'build-installer.ps1'
$catalogValidation = Join-Path (Split-Path $PSScriptRoot -Parent) 'BuildCatalogValidation.ps1'
$powershellExe = (Get-Command powershell.exe -ErrorAction Stop).Source
. $catalogValidation
. (Join-Path (Split-Path $PSScriptRoot -Parent) 'BuildLicenseConfiguration.ps1')

$validItem = '{"id":"sample","name":"Sample","category":"Furniture","preview":"previews/sample.jpg","driveFileId":"ABCDEFGHIJ","fileName":"sample.zip","sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}'
$validCatalog = ('{"version":1,"items":[' + $validItem + ']}') | ConvertFrom-Json
if (-not (Test-PublishedCatalogDocument $validCatalog)) {
    throw 'Expected a complete non-empty version 1 catalog array to pass production validation.'
}
foreach ($invalidJson in @(
    ('{"version":1,"items":' + $validItem + '}'),
    '{"version":1,"items":"sample"}',
    '{"version":1,"items":[]}',
    ('{"version":2,"items":[' + $validItem + ']}'),
    '{"version":1,"items":[{"id":"sample","name":"Sample","category":"Furniture","preview":"previews/sample.jpg","driveFileId":"ABCDEFGHIJ","fileName":"sample.zip"}]}',
    ('{"version":1,"items":[' + $validItem + ',' + $validItem + ']}'),
    '{"version":1,"items":[{"id":"sample","name":"Sample","category":"Furniture","preview":"previews/sample.jpg","driveFileId":"ABCDEFGHIJ","fileName":"sample.zip","sha256":"not-a-hash"}]}',
    '{"version":1,"items":[{"id":"sample","name":"Sample","category":"Furniture","preview":"previews/sample.jpg","driveFileId":"ABCDEFGHIJ","fileName":"sample.zip","sha256":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"}]}',
    '{"version":1,"items":[{"id":"sample","name":"Sample","category":"Furniture","preview":"previews/CON.jpg","driveFileId":"ABCDEFGHIJ","fileName":"sample.zip","sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}]}',
    '{"version":1,"items":[{"id":"sample","name":"Sample","category":"Furniture","preview":"previews/bad\"name.jpg","driveFileId":"ABCDEFGHIJ","fileName":"sample.zip","sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}]}',
    '{"version":1,"items":[{"id":"sample","name":"Sample","category":"Furniture","preview":"previews/folder./sample.jpg","driveFileId":"ABCDEFGHIJ","fileName":"sample.zip","sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}]}',
    '{"version":1,"items":[{"id":"sample","name":"Sample","category":"Furniture","preview":"previews/sample.jpg","driveFileId":"ABCDEFGHIJ","fileName":"COM1.zip","sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}]}'
)) {
    $invalidCatalog = $invalidJson | ConvertFrom-Json
    if (Test-PublishedCatalogDocument $invalidCatalog) {
        throw "Expected production validation to reject: $invalidJson"
    }
}

function Invoke-BuildProbe([string[]]$Arguments) {
    $previousPreference = $ErrorActionPreference
    $previousCatalogUrl = [Environment]::GetEnvironmentVariable('PLATFORM_CATALOG_URL', 'Process')
    $previousPublicKeyPath = [Environment]::GetEnvironmentVariable('PLATFORM_LICENSE_PUBLIC_KEY_PATH', 'Process')
    $ErrorActionPreference = 'Continue'
    try {
        [Environment]::SetEnvironmentVariable('PLATFORM_CATALOG_URL', $null, 'Process')
        [Environment]::SetEnvironmentVariable('PLATFORM_LICENSE_PUBLIC_KEY_PATH', $null, 'Process')
        $output = & $powershellExe -NoProfile -ExecutionPolicy Bypass -File $buildScript @Arguments 2>&1
        $exitCode = $LASTEXITCODE
    } finally {
        [Environment]::SetEnvironmentVariable('PLATFORM_CATALOG_URL', $previousCatalogUrl, 'Process')
        [Environment]::SetEnvironmentVariable('PLATFORM_LICENSE_PUBLIC_KEY_PATH', $previousPublicKeyPath, 'Process')
        $ErrorActionPreference = $previousPreference
    }
    return [pscustomobject]@{
        ExitCode = $exitCode
        Output = ($output -join [Environment]::NewLine)
    }
}

$production = Invoke-BuildProbe @()
if ($production.ExitCode -eq 0 -or $production.Output -notmatch 'Provide -LicensePublicKeyPath') {
    throw "Expected bundled catalog validation to pass and stop at the missing public key. Output: $($production.Output)"
}
$test = Invoke-BuildProbe @('-TestBuild')
if ($test.ExitCode -eq 0 -or $test.Output -notmatch 'Provide -LicensePublicKeyPath') {
    throw "Expected TestBuild to require a public key. Output: $($test.Output)"
}

$online = Invoke-BuildProbe @('-ApiBaseUrl', 'https://example.com')
if ($online.ExitCode -eq 0 -or $online.Output -notmatch 'Provide -LicensePublicKeyPath') {
    throw "Expected online build to require a public key. Output: $($online.Output)"
}

$tempKey = Join-Path ([IO.Path]::GetTempPath()) ([Guid]::NewGuid().ToString() + '.xml')
$rsa = New-Object Security.Cryptography.RSACryptoServiceProvider 2048
try {
    $rsa.PersistKeyInCsp = $false
    $public = $rsa.ToXmlString($false)
    [IO.File]::WriteAllText($tempKey, $public)
    $validated = Read-LicensePublicKey $tempKey
    $config = New-PluginBuildConfiguration $validated 'https://example.com/'
    $roundTrip = ($config | ConvertTo-Json) | ConvertFrom-Json
    if ($roundTrip.apiBaseUrl -ne 'https://example.com/' -or $roundTrip.licensePublicKeyXml -ne $public) { throw 'Online config must include public key and API URL.' }
    if ((New-PluginBuildConfiguration $validated).licensePublicKeyXml -ne $public) { throw 'Offline config must retain the public key.' }
    [IO.File]::WriteAllText($tempKey, $rsa.ToXmlString($true))
    $rejected = $false
    try { Read-LicensePublicKey $tempKey | Out-Null } catch { $rejected = $true }
    if (-not $rejected) { throw 'A private signing key must never enter an installer.' }
} finally {
    $rsa.Dispose()
    Remove-Item -LiteralPath $tempKey -Force -ErrorAction SilentlyContinue
}

Write-Output 'Build guard tests passed.'

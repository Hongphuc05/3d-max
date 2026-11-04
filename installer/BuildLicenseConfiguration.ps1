# Build configuration shared by online and offline installers. Only public keys
# may be shipped to clients; signing keys stay with the owner.
function Read-LicensePublicKey([string]$Path) {
    if (-not $Path -or -not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw 'Provide -LicensePublicKeyPath with the owner tool public XML key.' }
    if ((Get-Item -LiteralPath $Path).Length -gt 16384) { throw 'Public key file is too large.' }
    $xml = [IO.File]::ReadAllText((Resolve-Path -LiteralPath $Path))
    if ($xml -match '<!DOCTYPE|<!ENTITY|<\s*(D|P|Q|DP|DQ|InverseQ)\s*>|PRIVATE KEY') { throw 'Private keys and XML entities must never be packaged.' }
    $rsa = New-Object Security.Cryptography.RSACryptoServiceProvider
    try {
        $rsa.PersistKeyInCsp = $false
        $rsa.FromXmlString($xml)
        if (-not $rsa.PublicOnly -or $rsa.KeySize -lt 2048 -or $rsa.KeySize -gt 4096) { throw 'Expected an RSA public key of 2048 to 4096 bits.' }
        return $rsa.ToXmlString($false)
    } finally { $rsa.Dispose() }
}

function New-PluginBuildConfiguration([string]$PublicKeyXml, [string]$ApiBaseUrl = '') {
    $configuration = @{ licensePublicKeyXml = $PublicKeyXml }
    if ($ApiBaseUrl) { $configuration.apiBaseUrl = $ApiBaseUrl }
    return $configuration
}

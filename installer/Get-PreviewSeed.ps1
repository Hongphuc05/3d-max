# Keo anh preview ve de dong goi cung bo cai (seed): plugin copy chung vao cache o lan mo dau tien nen luoi khong trong.
# Nguon su that la GET /api/v1/previews/manifest cua moi truong dich. Thieu/hong BAT KY anh nao -> THAT BAI (khong dong goi seed thieu).
# (comment khong dau: PowerShell 5.1 doc file khong BOM theo ANSI)
param(
    [Parameter(Mandatory = $true)][string]$ApiBaseUrl,
    [Parameter(Mandatory = $true)][string]$OutputDirectory,
    [switch]$AllowInsecureLoopback
)
$ErrorActionPreference = 'Stop'

$uri = [Uri]$ApiBaseUrl
$loopback = $uri.IsLoopback -and $uri.Scheme -eq 'http' -and $AllowInsecureLoopback
if (($uri.Scheme -ne 'https' -and -not $loopback) -or $uri.UserInfo -or $uri.Query -or $uri.Fragment -or $uri.AbsolutePath -ne '/') {
    throw 'ApiBaseUrl must be an https origin without path (http only for loopback tests).'
}
$base = $uri.GetLeftPart([UriPartial]::Authority)
$MaxBytes = 8MB

function Get-Sha256Hex([byte[]]$Bytes) {
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha.ComputeHash($Bytes)) -replace '-', '').ToLowerInvariant() } finally { $sha.Dispose() }
}

function Get-Bytes([string]$Url, [int]$Limit) {
    $request = [Net.HttpWebRequest]::Create($Url)
    $request.AllowAutoRedirect = $false
    $request.Timeout = 60000
    $response = $request.GetResponse()
    try {
        if ([int]$response.StatusCode -ne 200) { throw "HTTP $([int]$response.StatusCode)" }
        $stream = $response.GetResponseStream()
        $buffer = New-Object IO.MemoryStream
        $chunk = New-Object byte[] 65536
        while (($read = $stream.Read($chunk, 0, $chunk.Length)) -gt 0) {
            if ($buffer.Length + $read -gt $Limit) { throw 'response too large' }
            $buffer.Write($chunk, 0, $read)
        }
        return $buffer.ToArray()
    } finally { $response.Dispose() }
}

Write-Host "==> Fetch preview manifest from $base"
$manifestBytes = Get-Bytes "$base/api/v1/previews/manifest" (8MB)
$manifest = [Text.Encoding]::UTF8.GetString($manifestBytes) | ConvertFrom-Json
if (-not $manifest -or $manifest.catalogVersion -isnot [int] -and $manifest.catalogVersion -isnot [long] -or $null -eq $manifest.previews) { throw 'Preview manifest is malformed.' }
$entries = @($manifest.previews)
if ($entries.Count -eq 0) { throw 'Preview manifest is empty: publish the catalog before building an installer.' }

$resolved = [IO.Path]::GetFullPath($OutputDirectory)
if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Recurse -Force }
New-Item -ItemType Directory -Path $resolved -Force | Out-Null

$files = @{}
foreach ($entry in $entries) {
    $sha = [string]$entry.sha256
    $size = [long]$entry.fileSize
    if ($sha -cnotmatch '^[0-9a-f]{64}$' -or $entry.url -cne "/previews/$sha.webp" -or $size -lt 1 -or $size -gt $MaxBytes) { throw "Manifest entry is invalid: $sha" }
    if ($files.ContainsKey($sha)) { continue }
    try { $bytes = Get-Bytes "$base/previews/$sha.webp" $MaxBytes } catch { throw "Preview $sha could not be downloaded: $($_.Exception.Message)" }
    if ($bytes.Length -ne $size -or (Get-Sha256Hex $bytes) -ne $sha) { throw "Preview $sha does not match the manifest (size or sha256)." }
    [IO.File]::WriteAllBytes((Join-Path $resolved "$sha.webp"), $bytes)
    $files[$sha] = $size
}

$seed = @{ version = 1; catalogVersion = [int]$manifest.catalogVersion; files = @($files.GetEnumerator() | Sort-Object Name | ForEach-Object { @{ sha256 = $_.Name; size = $_.Value } }) }
# Manifest viet SAU CUNG: thu muc co seed-manifest.json nghia la da du anh.
[IO.File]::WriteAllText((Join-Path $resolved 'seed-manifest.json'), ($seed | ConvertTo-Json -Depth 4), (New-Object Text.UTF8Encoding($false)))
Write-Host ("==> Seed ready: {0} previews, catalog version {1}" -f $files.Count, $manifest.catalogVersion)

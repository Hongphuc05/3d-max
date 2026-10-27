function Test-SafeCatalogPath {
    [CmdletBinding()]
    param([AllowNull()][object]$Path)

    if ($Path -isnot [string] -or $Path.Length -eq 0 -or $Path.Length -gt 500 -or $Path -match '[\\%?#:]') { return $false }
    foreach ($segment in $Path.Split('/')) {
        if ([string]::IsNullOrEmpty($segment) -or $segment -eq '.' -or $segment -eq '..') { return $false }
        if ($segment -match '[\x00-\x1f<>"|*]' -or $segment -match '[. ]$') { return $false }
        if ($segment.Split('.')[0] -match '^(?i:CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])$') { return $false }
    }
    return $true
}

function Test-PublishedCatalogDocument {
    [CmdletBinding()]
    param([AllowNull()][object]$Catalog)

    if ($null -eq $Catalog -or $Catalog.version -ne 1) { return $false }
    $items = $Catalog.items
    if ($items -isnot [Array] -or $items.Count -lt 1 -or $items.Count -gt 10000) { return $false }
    $seenIds = @{}
    foreach ($item in $items) {
        if ($null -eq $item) { return $false }
        $id = $item.id
        $name = $item.name
        $category = $item.category
        $preview = $item.preview
        $driveFileId = $item.driveFileId
        $fileName = $item.fileName
        $sha256 = $item.sha256
        if ($id -isnot [string] -or $id -notmatch '^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$') { return $false }
        $idKey = $id.ToLowerInvariant()
        if ($seenIds.ContainsKey($idKey)) { return $false }
        $seenIds[$idKey] = $true
        if ($name -isnot [string] -or [string]::IsNullOrWhiteSpace($name) -or $name.Length -gt 200) { return $false }
        if ($category -isnot [string] -or [string]::IsNullOrWhiteSpace($category) -or $category.Length -gt 200) { return $false }
        if (-not (Test-SafeCatalogPath $preview) -or $preview -notmatch '(?i)\.(png|jpe?g|webp)$') { return $false }
        if ($driveFileId -isnot [string] -or $driveFileId -notmatch '^[A-Za-z0-9_-]{10,200}$' -or $driveFileId -match '(?i)REPLACE|PLACEHOLDER') { return $false }
        if ($fileName -isnot [string] -or $fileName.Length -gt 200 -or $fileName.Contains('/') -or -not (Test-SafeCatalogPath $fileName) -or $fileName -notmatch '(?i)\.(zip|rar|7z|max|fbx|obj)$') { return $false }
        if ($sha256 -isnot [string] -or $sha256 -cnotmatch '^[a-f0-9]{64}$') { return $false }
        if ($null -ne $item.entryFile -and (-not (Test-SafeCatalogPath $item.entryFile) -or $item.entryFile -notmatch '(?i)\.(max|fbx|obj)$')) { return $false }
    }
    return $true
}

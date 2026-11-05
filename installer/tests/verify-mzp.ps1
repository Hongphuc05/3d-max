param([Parameter(Mandatory = $true)][string]$PackagePath)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead([IO.Path]::GetFullPath($PackagePath))
try {
    if ($archive.Entries | Where-Object { $_.FullName.Contains('\') }) { throw 'MZP entries must use portable forward slashes.' }
    $names = @($archive.Entries | ForEach-Object { $_.FullName.Replace('\', '/') })
    foreach ($required in @('mzp.run', 'install.ms', 'PlatformLoader.ms', 'payload-id.txt', 'version.txt', 'Platform-OpenPanel.mcr', 'Platform-Agent.ms', 'payload/MaxWebViewHost.dll', 'payload/PlatformBridge.ms', 'payload/ThirdPartyNotices.txt', 'payload/plugin-config.json', 'payload/app/index.html')) {
        if ($names -cnotcontains $required) { throw "MZP missing $required" }
    }
    if ($names | Where-Object { $_ -match '(^|/)(\.\.?)(/|$)|^[\\/]|:|\.exe$|\.zip$|Cai-thu-cong|HUONG-DAN-CAI-DAT' }) { throw 'MZP contains unsafe or duplicate distribution files.' }
    if (($names | Select-Object -Unique).Count -ne $names.Count) { throw 'MZP has duplicate paths.' }
    if (@($names | Where-Object { $_ -match '(^|/)MaxWebViewHost\.dll$' }).Count -ne 1) { throw 'Runtime must be included exactly once.' }
    if (-not ($names | Where-Object { $_ -match '^payload/runtimes/.+/WebView2Loader\.dll$' })) { throw 'MZP missing WebView2 loader.' }
    $reader = New-Object IO.StreamReader($archive.GetEntry('mzp.run').Open())
    try { $control = $reader.ReadToEnd() } finally { $reader.Dispose() }
    if ($control -notmatch '(?m)^run "install\.ms"\s*$' -or $control -notmatch '(?m)^drop "install\.ms"\s*$') { throw 'MZP must support Run Script and drag/drop.' }
    $reader = New-Object IO.StreamReader($archive.GetEntry('payload-id.txt').Open())
    try { if ($reader.ReadToEnd() -notmatch '^v-[0-9a-f]{64}$') { throw 'Invalid payload identity.' } } finally { $reader.Dispose() }
    foreach ($scriptName in @('install.ms', 'PlatformLoader.ms')) {
        $scriptReader = New-Object IO.StreamReader($archive.GetEntry($scriptName).Open())
        try { $scriptSource = $scriptReader.ReadToEnd() } finally { $scriptReader.Dispose() }
        if ($scriptSource -match '\(\)\s*\.') { throw "MAXScript method result must be parenthesized before member access: $scriptName" }
        if ($scriptSource -match 'ioFile\.Replace\s+\S+\s+\S+\s+undefined\b') { throw "MAXScript File.Replace requires an explicit string backup path: $scriptName" }
    }
    Write-Host "MZP structure verified ($($names.Count) entries)."
} finally { $archive.Dispose() }

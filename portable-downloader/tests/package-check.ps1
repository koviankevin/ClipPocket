$ErrorActionPreference = 'Stop'
$appRoot = Split-Path $PSScriptRoot
$workspaceRoot = Split-Path $appRoot
$version=(Get-Content -Raw -LiteralPath (Join-Path $appRoot 'version.json') | ConvertFrom-Json).version
$archive = Join-Path $workspaceRoot ('releases\ClipPocket-' + $version + '-Windows-x64-portable.zip')
$verifyRoot = Join-Path $workspaceRoot ('portable-build-cache\unpacked verification-' + [guid]::NewGuid().ToString('N'))
Expand-Archive -LiteralPath $archive -DestinationPath $verifyRoot
$unpacked = Join-Path $verifyRoot 'ClipPocket'
$manifest = Get-Content -Raw -LiteralPath (Join-Path $unpacked 'runtime-manifest.json') | ConvertFrom-Json
foreach ($file in $manifest.files) {
    $actual = (Get-FileHash -LiteralPath (Join-Path $unpacked $file.path) -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $file.sha256) { throw ('Packaged runtime hash mismatch: ' + $file.path) }
}
if (Test-Path -LiteralPath (Join-Path $unpacked 'data')) { throw 'Archive unexpectedly contains personal application data' }
$env:CLIPPOCKET_TEST_MODE = '1'
$launch = Start-Process -FilePath (Join-Path $unpacked 'ClipPocket.exe') -WorkingDirectory $unpacked -WindowStyle Hidden -PassThru
if (-not $launch.WaitForExit(10000)) { throw 'Unpacked launcher did not return' }
if ($launch.ExitCode -ne 0) { throw 'Unpacked native launcher failed' }
$info = $null
try {
    $bootLimit = (Get-Date).AddSeconds(20)
    while ((Get-Date) -lt $bootLimit) {
        $instancePath = Join-Path $unpacked '.instance.json'
        if (Test-Path -LiteralPath $instancePath) {
            $info = Get-Content -Raw -LiteralPath $instancePath | ConvertFrom-Json
            $health = Invoke-RestMethod -Uri ('http://127.0.0.1:' + $info.port + '/health')
            if ($health.app -eq 'ClipPocket' -and $health.version -eq $version) { break }
        }
        Start-Sleep -Milliseconds 200
    }
    if (-not $info) { throw 'Unpacked app did not start' }
    $base = 'http://127.0.0.1:' + $info.port
    $headers = @{'X-ClipPocket-Token'=$info.token}
    $state = Invoke-RestMethod -Uri ($base + '/api/state') -Headers $headers
    if ($state.files.Count -ne 0) { throw 'Archive has previous download history' }
    if ($state.folder -ne (Join-Path $unpacked 'Downloads')) { throw 'Default folder is not portable' }
    $html = (Invoke-WebRequest -Uri ($base + '/')).Content
    if ($html -notmatch '<option value="browser">透過瀏覽器下載管理員（預設）</option>') { throw 'Browser delivery is not the default option' }
    Invoke-RestMethod -Method Post -Uri ($base + '/api/analyze') -Headers $headers -ContentType 'application/json' -Body '{"url":"https://www.bilibili.com/video/BV1nx411u79K"}' | Out-Null
    $taskLimit = (Get-Date).AddSeconds(60)
    do {
        Start-Sleep -Milliseconds 400
        $state = Invoke-RestMethod -Uri ($base + '/api/state') -Headers $headers
    } while ($state.busy -and (Get-Date) -lt $taskLimit)
    if ($state.busy -or $state.error -or $state.video.id -ne 'BV1nx411u79K') { throw ('Unpacked Bilibili compatibility check failed: ' + $state.error) }
    $report = [pscustomobject]@{
        status='pass'
        testedAt=(Get-Date).ToUniversalTime().ToString('o')
        archiveSha256=(Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
        runtimeHashes=$manifest.files.Count
        nativeLauncher='pass'
        cleanHistory='pass'
        portableOutputFolder='pass'
        browserDeliveryDefault='pass'
        bilibiliExtraction='pass'
    }
    $report | ConvertTo-Json | Set-Content -Encoding UTF8 -LiteralPath (Join-Path $appRoot 'evidence\package-report.json')
    $report | ConvertTo-Json | Write-Output
} finally {
    if ($info) {
        try { Invoke-RestMethod -Method Post -Uri ('http://127.0.0.1:' + $info.port + '/api/shutdown') -Headers @{'X-ClipPocket-Token'=$info.token} -ContentType 'application/json' -Body '{}' | Out-Null } catch {}
    }
}

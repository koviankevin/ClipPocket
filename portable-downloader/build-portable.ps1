$ErrorActionPreference = 'Stop'
$appRoot = $PSScriptRoot
$workspaceRoot = Split-Path $appRoot
$version = (Get-Content -Raw -LiteralPath (Join-Path $appRoot 'version.json') | ConvertFrom-Json).version
$reportPath = Join-Path $appRoot 'evidence\feature-report.json'
$report = Get-Content -Raw -LiteralPath $reportPath | ConvertFrom-Json
if ($report.status -ne 'pass' -or @($report.downloads | Where-Object { $_.platform -eq 'Bilibili' }).Count -lt 2) {
    throw 'Bilibili MP4/MP3 and quality/folder integration checks must pass before packaging.'
}
$fourK = Get-Content -Raw -LiteralPath (Join-Path $appRoot 'evidence\4k-report.json') | ConvertFrom-Json
if ($fourK.status -ne 'pass') { throw 'The real 4K excerpt check must pass.' }
$browserReport = Get-Content -Raw -LiteralPath (Join-Path $appRoot 'evidence\browser-report.json') | ConvertFrom-Json
if ($browserReport.status -ne 'pass' -or $browserReport.version -ne $version) { throw 'Current-version browser delivery checks must pass.' }
$updateReport = Get-Content -Raw -LiteralPath (Join-Path $appRoot 'evidence\update-report.json') | ConvertFrom-Json
if ($updateReport.status -ne 'pass' -or $updateReport.version -ne $version) { throw 'Current-version update and rollback checks must pass.' }
$interfaceReport = Get-Content -Raw -LiteralPath (Join-Path $appRoot 'evidence\interface-report.json') | ConvertFrom-Json
if ($interfaceReport.status -ne 'pass' -or $interfaceReport.version -ne $version) { throw 'Current-version readability and shutdown UI checks must pass.' }
$tabReport = Get-Content -Raw -LiteralPath (Join-Path $appRoot 'evidence\tab-close-report.json') | ConvertFrom-Json
if ($tabReport.status -ne 'pass' -or $tabReport.version -ne $version) { throw 'Current-version automatic tab closing and browser fallback checks must pass.' }
$defaultReport = Get-Content -Raw -LiteralPath (Join-Path $appRoot 'evidence\default-browser-report.json') | ConvertFrom-Json
if ($defaultReport.status -ne 'pass' -or $defaultReport.version -ne $version) { throw 'Current-version default browser launch checks must pass.' }
$buildRoot = Join-Path $workspaceRoot ('portable-build-cache\package-' + [guid]::NewGuid().ToString('N'))
$stageRoot = Join-Path $buildRoot 'ClipPocket'
$releaseRoot = Join-Path $workspaceRoot 'releases'
New-Item -ItemType Directory -Path $stageRoot,$releaseRoot -Force | Out-Null
$include = @('app.cjs','quality.cjs','browser-downloads.cjs','updates.cjs','version.json','ClipPocket.exe','Updater.exe','Launcher.cs','Updater.cs','使用說明.txt','THIRD_PARTY.md','SOURCE_CODE.md','驗證摘要.md','bin','licenses','ui')
foreach ($item in $include) {
    Copy-Item -LiteralPath (Join-Path $appRoot $item) -Destination $stageRoot -Recurse
}
Copy-Item -LiteralPath $reportPath -Destination (Join-Path $stageRoot '驗證結果.json')
Copy-Item -LiteralPath (Join-Path $appRoot 'evidence\4k-report.json') -Destination (Join-Path $stageRoot '4K片段驗證.json')
Copy-Item -LiteralPath (Join-Path $appRoot 'evidence\folder-report.json') -Destination (Join-Path $stageRoot '資料夾視窗驗證.json')
Copy-Item -LiteralPath (Join-Path $appRoot 'evidence\browser-report.json') -Destination (Join-Path $stageRoot '瀏覽器儲存驗證.json')
Copy-Item -LiteralPath (Join-Path $appRoot 'evidence\update-report.json') -Destination (Join-Path $stageRoot '更新驗證.json')
$compatRelative='compat\clippocket\yt_dlp_plugins\extractor\bilibili_compat.py'
New-Item -ItemType Directory -Path (Split-Path (Join-Path $stageRoot $compatRelative)) -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $appRoot $compatRelative) -Destination (Join-Path $stageRoot $compatRelative)
# The updater owns exactly these packaged files. User data is never in this list.
$manifestFiles = @(Get-ChildItem -LiteralPath $stageRoot -File -Recurse | ForEach-Object {
    [pscustomobject]@{path=[System.IO.Path]::GetRelativePath($stageRoot, $_.FullName).Replace('\','/');bytes=$_.Length;sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()}
})
[pscustomobject]@{application='ClipPocket';version=$version;platform='windows-x64';generatedAt=(Get-Date).ToUniversalTime().ToString('o');files=$manifestFiles} |
    ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 -LiteralPath (Join-Path $stageRoot 'runtime-manifest.json')
Copy-Item -LiteralPath (Join-Path $stageRoot 'runtime-manifest.json') -Destination (Join-Path $appRoot 'runtime-manifest.json') -Force
$archive = Join-Path $releaseRoot ('ClipPocket-' + $version + '-Windows-x64-portable.zip')
Compress-Archive -LiteralPath $stageRoot -DestinationPath $archive -CompressionLevel Optimal -Force
$digest = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
[System.IO.File]::WriteAllText(($archive + '.sha256'), ($digest + '  ' + [System.IO.Path]::GetFileName($archive) + [Environment]::NewLine))
[pscustomobject]@{
    archive = $archive
    bytes = (Get-Item -LiteralPath $archive).Length
    sha256 = $digest
    staging = $stageRoot
} | ConvertTo-Json | Write-Output

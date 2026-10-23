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
$manifestPaths = @((Get-ChildItem -LiteralPath (Join-Path $appRoot 'bin') -File -Recurse | ForEach-Object { [System.IO.Path]::GetRelativePath($appRoot, $_.FullName).Replace('\','/') }))
$manifestPaths += @('app.cjs','quality.cjs','browser-downloads.cjs','version.json','ClipPocket.exe','ui/index.html','ui/ui.js','ui/style.css','compat/clippocket/yt_dlp_plugins/extractor/bilibili_compat.py')
$manifestFiles = @($manifestPaths | ForEach-Object {
    $filePath = Join-Path $appRoot $_
    [pscustomobject]@{path=$_;bytes=(Get-Item -LiteralPath $filePath).Length;sha256=(Get-FileHash -LiteralPath $filePath -Algorithm SHA256).Hash.ToLowerInvariant()}
})
[pscustomobject]@{application='ClipPocket';version=$version;platform='windows-x64';generatedAt=(Get-Date).ToUniversalTime().ToString('o');files=$manifestFiles} |
    ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 -LiteralPath (Join-Path $appRoot 'runtime-manifest.json')
$buildRoot = Join-Path $workspaceRoot ('portable-build-cache\package-' + [guid]::NewGuid().ToString('N'))
$stageRoot = Join-Path $buildRoot 'ClipPocket'
$releaseRoot = Join-Path $workspaceRoot 'releases'
New-Item -ItemType Directory -Path $stageRoot,$releaseRoot -Force | Out-Null
$include = @('app.cjs','quality.cjs','browser-downloads.cjs','version.json','ClipPocket.exe','Launcher.cs','使用說明.txt','THIRD_PARTY.md','SOURCE_CODE.md','驗證摘要.md','runtime-manifest.json','bin','licenses','ui')
foreach ($item in $include) {
    Copy-Item -LiteralPath (Join-Path $appRoot $item) -Destination $stageRoot -Recurse
}
Copy-Item -LiteralPath $reportPath -Destination (Join-Path $stageRoot '驗證結果.json')
Copy-Item -LiteralPath (Join-Path $appRoot 'evidence\4k-report.json') -Destination (Join-Path $stageRoot '4K片段驗證.json')
Copy-Item -LiteralPath (Join-Path $appRoot 'evidence\folder-report.json') -Destination (Join-Path $stageRoot '資料夾視窗驗證.json')
Copy-Item -LiteralPath (Join-Path $appRoot 'evidence\browser-report.json') -Destination (Join-Path $stageRoot '瀏覽器儲存驗證.json')
$compatRelative='compat\clippocket\yt_dlp_plugins\extractor\bilibili_compat.py'
New-Item -ItemType Directory -Path (Split-Path (Join-Path $stageRoot $compatRelative)) -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $appRoot $compatRelative) -Destination (Join-Path $stageRoot $compatRelative)
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

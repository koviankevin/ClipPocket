param([switch]$VerifyOnly)
$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSVersion.Major -lt 7) { throw 'Use PowerShell 7 to prepare the development runtime.' }
$appRoot = $PSScriptRoot
$manifest = Get-Content -Raw -LiteralPath (Join-Path $appRoot 'runtime-manifest.json') | ConvertFrom-Json
function Verify-Binaries {
    foreach ($entry in @($manifest.files | Where-Object { $_.path.StartsWith('bin/') })) {
        $file = Join-Path $appRoot $entry.path
        if (-not (Test-Path -LiteralPath $file)) { throw ('Missing runtime: ' + $entry.path) }
        if ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() -ne $entry.sha256) { throw ('Runtime hash mismatch: ' + $entry.path) }
    }
}
if ($VerifyOnly) { Verify-Binaries; Write-Output 'All pinned runtime hashes match.'; exit 0 }
$cache = Join-Path (Split-Path $appRoot) 'portable-build-cache\runtime-setup'
New-Item -ItemType Directory -Path $cache -Force | Out-Null
function Download-Checked($Url, $Name, $ChecksumUrl) {
    $destination = Join-Path $cache $Name
    $checksumFile = Join-Path $cache ($Name + '.checksums')
    Invoke-WebRequest -Uri $ChecksumUrl -OutFile $checksumFile
    $line = @(Get-Content -LiteralPath $checksumFile | Where-Object { $_ -match ('\s\*?' + [regex]::Escape($Name) + '$') })
    if ($line.Count -ne 1) { throw ('No unique official checksum for ' + $Name) }
    $expected = ($line[0] -split '\s+')[0].ToLowerInvariant()
    if (-not (Test-Path -LiteralPath $destination) -or (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) {
        Invoke-WebRequest -Uri $Url -OutFile $destination
    }
    if ((Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) { throw ('Download checksum mismatch: ' + $Name) }
    return $destination
}
$nodeBase = 'https://nodejs.org/dist/v24.19.0'
$nodeZip = Download-Checked ($nodeBase + '/node-v24.19.0-win-x64.zip') 'node-v24.19.0-win-x64.zip' ($nodeBase + '/SHASUMS256.txt')
$engineBase = 'https://github.com/yt-dlp/yt-dlp/releases/download/2026.10.21'
$engine = Download-Checked ($engineBase + '/yt-dlp.exe') 'yt-dlp.exe' ($engineBase + '/SHA2-256SUMS')
$ffBase = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-10-22-13-06'
$ffName = 'ffmpeg-n9.0.2-33-g4cf298e66a-win64-gpl-shared-9.0.zip'
$ffZip = Download-Checked ($ffBase + '/' + $ffName) $ffName ($ffBase + '/checksums.sha256')
$nodeExtract = Join-Path $cache 'node'
$ffExtract = Join-Path $cache 'ffmpeg'
Expand-Archive -LiteralPath $nodeZip -DestinationPath $nodeExtract -Force
Expand-Archive -LiteralPath $ffZip -DestinationPath $ffExtract -Force
$bin = Join-Path $appRoot 'bin'
$ffBin = Join-Path $bin 'ffmpeg'
New-Item -ItemType Directory -Path $bin,$ffBin -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $nodeExtract 'node-v24.19.0-win-x64\node.exe') -Destination (Join-Path $bin 'node.exe') -Force
Copy-Item -LiteralPath $engine -Destination (Join-Path $bin 'yt-dlp.exe') -Force
$ffSourceBin = Join-Path $ffExtract 'ffmpeg-n9.0.2-33-g4cf298e66a-win64-gpl-shared-9.0\bin'
foreach ($entry in @($manifest.files | Where-Object { $_.path.StartsWith('bin/ffmpeg/') })) {
    Copy-Item -LiteralPath (Join-Path $ffSourceBin ([System.IO.Path]::GetFileName($entry.path))) -Destination (Join-Path $appRoot $entry.path) -Force
}
Verify-Binaries
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $compiler)) { throw 'The Windows .NET Framework C# compiler was not found.' }
& $compiler /nologo /target:winexe /reference:System.Windows.Forms.dll ('/out:' + (Join-Path $appRoot 'ClipPocket.exe')) (Join-Path $appRoot 'Launcher.cs')
if ($LASTEXITCODE -ne 0) { throw 'Launcher compilation failed.' }
& $compiler /nologo /target:winexe /reference:System.Windows.Forms.dll /reference:System.Web.Extensions.dll /reference:System.IO.Compression.dll /reference:System.IO.Compression.FileSystem.dll ('/out:' + (Join-Path $appRoot 'Updater.exe')) (Join-Path $appRoot 'Updater.cs')
if ($LASTEXITCODE -ne 0) { throw 'Updater compilation failed.' }
Write-Output 'Pinned runtimes are ready. Launch portable-downloader/ClipPocket.exe.'

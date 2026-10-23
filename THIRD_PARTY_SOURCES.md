# 隨附元件對應來源

公開下載：[ClipPocket Releases](https://github.com/koviankevin/ClipPocket/releases)。程式碼、授權與來源附件分開提供；來源附件不需要放入程式資料夾。

## FFmpeg

本版隨附 BtbN `autobuild-2026-10-22-13-06` 的 Windows x64 GPL shared 9.0 建置，程式版本為 `n9.0.2-33-g4cf298e66a-20261022`。官方 binary 未修改，實際檔案雜湊見 `runtime-manifest.json`。

同一 ClipPocket Release 提供：

- `ffmpeg-4cf298e66a-source.tar.gz`：FFmpeg commit `4cf298e66a20dd90e8b7c62333ab5812596835ec` 的原始碼快照。
- `FFmpeg-Builds-9378683-source.tar.gz`：BtbN 建置配方 commit `937868360a21d711ec94a33f5591d345ad9b7754`，包含相依套件的固定來源版本、補丁、授權檔案及建置腳本。
- `ffmpeg-dependency-sources-20261022.tar.gz.part01`、`.part02`：官方同日建置工作使用的完整 `download-cache`。包含 `.cache/downloads` 內各相依套件的來源封裝；快取亦涵蓋上游其他變體使用的來源。
- `ffmpeg-build-configuration.txt`：實際隨附 binary 回報的建置參數。
- `SOURCE_SHA256SUMS.txt`：各來源附件的校驗碼。

相依來源快取出處：[官方 Actions run 39776938430](https://github.com/BtbN/FFmpeg-Builds/actions/runs/39776938430)，artifact `download-cache`（ID `12424698518`），上游紀錄的 head commit 為上述建置配方版本。此副本保存於 ClipPocket Release，避免只依賴會過期的 Actions artifact。

官方 artifact ZIP 的 SHA-256 為 `f89c6c43969d92c8b95cb459a90fbafbc743d3d3cc4d16c610317f9ceef922f8`；下載後會與 GitHub API 提供的 digest 核對。解出其中的 `cache.tar.gz` 後再分割，兩個來源 part 的 SHA-256 及重組後的完整檔案 SHA-256 另記於 Release 的來源校驗碼清單。

原始碼來源：[FFmpeg 固定 commit](https://github.com/FFmpeg/FFmpeg/tree/4cf298e66a20dd90e8b7c62333ab5812596835ec)、[BtbN 固定建置配方](https://github.com/BtbN/FFmpeg-Builds/tree/937868360a21d711ec94a33f5591d345ad9b7754)。BtbN 在配方的 `scripts.d` 中記錄相依套件的 repo、commit／archive 與補丁。

重組分割檔（PowerShell，兩個 part 必須先下載到同一目錄）：

```powershell
$destination = [System.IO.File]::Create((Join-Path (Get-Location) 'ffmpeg-dependency-sources-20261022.tar.gz'))
try {
    foreach ($name in @('ffmpeg-dependency-sources-20261022.tar.gz.part01','ffmpeg-dependency-sources-20261022.tar.gz.part02')) {
        $source = [System.IO.File]::OpenRead((Join-Path (Get-Location) $name))
        try { $source.CopyTo($destination) } finally { $source.Dispose() }
    }
} finally { $destination.Dispose() }
tar -xzf ffmpeg-dependency-sources-20261022.tar.gz
```

在解開的建置配方目錄中還原 `.cache/downloads`，依上游 README 使用 Docker 執行 `./makeimage.sh win64 gpl-shared 9.0` 及 `./build.sh win64 gpl-shared 9.0`。建置 FFmpeg 時需使用上述固定 FFmpeg commit；環境及相依工具鏈可能使重建檔案的位元組不同，並未宣稱可產生完全相同的 binary。

FFmpeg 為 GPLv3 建置，授權全文見 `portable-downloader/licenses/ffmpeg-GPLv3.txt`；各相依套件的授權見來源快取。ClipPocket 透過獨立子程序使用 FFmpeg。

## yt-dlp 與 Python 相依元件

官方執行檔版本 `2026.10.21`，SHA-256 `33121d192d706e62f684a06f80918e3f3a8ba52ac3a65213b6951c39c7d9f555`，未修改。

- [官方同版本 Release](https://github.com/yt-dlp/yt-dlp/releases/tag/2026.10.21)；同一 ClipPocket Release 另保留 `yt-dlp-2026.10.21-source.tar.gz`。
- 原專案的 [固定版本原始碼](https://github.com/yt-dlp/yt-dlp/tree/2026.10.21)，包括打包與建置腳本。
- 隨官方執行檔提供的完整第三方授權清單：`portable-downloader/licenses/yt-dlp-THIRD_PARTY_LICENSES.txt`。清單列出各元件的原專案來源；其中的上游來源取得說明及聯絡方式也保留原文。
- ClipPocket Bilibili 相容橋接的原始碼位於 `portable-downloader/compat/clippocket/yt_dlp_plugins/extractor/bilibili_compat.py`，不修改官方執行檔。

官方 Windows 執行檔實際回報的相依版本包括 Mutagen `1.48.1`（GPL-2.0-or-later）及 certifi `2026.10.19`（MPL-2.0）。同一 ClipPocket Release 另外保存由 PyPI 取得、核對官方 SHA-256 的 `mutagen-1.48.1-source.tar.gz` 與 `certifi-2026.10.19-source.tar.gz`。上游第三方清單也包含其他平台建置的元件，不代表每個列出的元件都在 Windows binary 中使用。

## Node.js

隨附 Node.js `v24.19.0` Windows x64，未修改。[官方固定版本下載與來源](https://nodejs.org/dist/v24.19.0/)，原始碼檔為 `node-v24.19.0.tar.gz`；完整授權與第三方 notices 已保留於 `portable-downloader/licenses/node-LICENSE.txt`。

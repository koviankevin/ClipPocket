# 隨附元件

此工具在使用者本機執行，不呼叫代管的影片解析或下載 API。初次解壓縮後已包含執行所需的下載元件，不需另外安裝執行環境。

| 元件 | 本次版本 | 官方來源 | 授權文件 |
| --- | --- | --- | --- |
| yt-dlp Windows executable | 2026.10.21 | https://github.com/yt-dlp/yt-dlp/releases/tag/2026.10.21 | licenses/yt-dlp-LICENSE.txt、licenses/yt-dlp-THIRD_PARTY_LICENSES.txt |
| Node.js Windows x64 | v24.19.0 | https://nodejs.org/dist/v24.19.0/ | licenses/node-LICENSE.txt |
| FFmpeg / ffprobe shared Windows x64 | n9.0.2-33-g4cf298e66a-20261022 | https://github.com/BtbN/FFmpeg-Builds/releases | licenses/ffmpeg-GPLv3.txt |

FFmpeg 原始碼：https://github.com/FFmpeg/FFmpeg/commit/4cf298e66a

FFmpeg 建置配方與相依元件來源：https://github.com/BtbN/FFmpeg-Builds

yt-dlp bundled executable 內含其他元件，請保留完整 THIRD_PARTY_LICENSES。Node LICENSE 也含 bundled dependencies 的 notices。FFmpeg GPL shared build 的 GPL 授權適用於隨附 FFmpeg 元件。

公開版本與下載：https://github.com/koviankevin/ClipPocket/releases 。同一 Release 提供 FFmpeg 固定版本原始碼、建置配方與官方相依原始碼快取；來源與重組說明見 SOURCE_CODE.md。ClipPocket 自有程式使用 MIT 授權，第三方元件仍依各自授權。

## 取得檔案的 SHA-256

v0.2 隨附的 `compat/clippocket/yt_dlp_plugins/extractor/bilibili_compat.py` 是最小本機相容橋接：當觀看頁不含初始資料時，讀取 yt-dlp 已使用的同一個簽章公開詳細資料 API，再交回原解析流程。參考上游已提出的修正 https://github.com/yt-dlp/yt-dlp/pull/17898 ，不會解鎖登入、會員或受限內容。啟動參數清除其他外掛搜尋路徑，只載入隨附的相容橋接；官方 yt-dlp.exe 保持原檔與原 SHA-256。

- yt-dlp.exe：`33121d192d706e62f684a06f80918e3f3a8ba52ac3a65213b6951c39c7d9f555`
- FFmpeg 下載 archive：`cf9a48b5c4bab564fdd49e0470c2c6a1464af2ce9a65e38f8e7b26d9f52b5465`

兩份下載 archive 均已與發行方提供的 SHA-256 清單比對。打包後各 binary 的實際 hash 另記在 runtime-manifest.json。

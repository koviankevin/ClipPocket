# ClipPocket · 影片帶著走

Windows 免安裝影片下載工具，支援 YouTube、Facebook 與 Bilibili 的公開、免登入單支影片。用瀏覽器操作，在自己的電腦下載、合併影音及轉檔，不需要訂閱或架設伺服器。

**[下載與操作教學](https://koviankevin.github.io/ClipPocket/)** · [GitHub 最新正式版本](https://github.com/koviankevin/ClipPocket/releases/latest) · [版本紀錄](https://github.com/koviankevin/ClipPocket/releases)

v0.5.1 恢復使用 Windows 預設瀏覽器，下載會記在該瀏覽器目前使用的下載清單，儲存位置依瀏覽器設定。按「關閉工具」會停止本機程式；分頁可能需要自行關閉。

## 開始使用

1. 到 Release 下載 `ClipPocket-版本號-Windows-x64-portable.zip`。一般使用者只需要這個 ZIP，其他來源附件提供給開發者。
2. **完整解壓縮整個資料夾**，雙擊 `ClipPocket.exe`。請保留隨附檔案，單獨複製 EXE 無法執行。
3. 貼上影片網址（省略 https:// 也可），按「讀取資訊」，選 MP4／MP3、畫質及輸出模式。讀取進度或錯誤會直接顯示在網址欄下方。
4. 預設完成處理後交給瀏覽器下載管理員，儲存位置依你的瀏覽器設定。
5. 若未自動開始，按最近處理中的「再次儲存到瀏覽器」。**等瀏覽器完成儲存，再按「關閉工具」。** 工具會停止本機程式並嘗試自動關閉目前分頁；若瀏覽器不允許，會顯示完成畫面，按 Ctrl＋W 即可關閉分頁。

適用 Windows 10 22H2／Windows 11 x64；目前實測環境為 Windows x64。免安裝包已包含 Node.js、yt-dlp、FFmpeg，不必另外安裝 Python 或執行環境。程式尚未簽章，Windows 可能顯示未知發行者。

v0.4.0 起，工具會在開啟時自動檢查正式版本，有新版時按「一鍵更新」即可下載、校驗、套用並自動重開，保留設定與已儲存檔案。請先在瀏覽器下載清單確認成品已儲存，更新重開會清除此次瀏覽器暫存。v0.3.0 或更舊版本需先手動下載、解壓新版一次。

## 功能

- MP4 影片或 MP3 音訊（192 kbps）。
- 畫質依來源實際提供的解析度與幀率列出，包含來源有提供時的 4K／60fps，不會放大原片。
- 相容模式：必要時轉成 H.264＋AAC，保留所選解析度與幀率。
- 保留來源編碼：合併／封裝，減少轉檔；部分播放器可能無法播放 AV1／VP9。
- 預設交給瀏覽器儲存，也能改成直接存到指定資料夾。
- 本機處理進度、取消工作、最近處理紀錄。
- 自動檢查正式版本、手動檢查及一鍵更新；新版無法啟動時自動嘗試還原。

瀏覽器顯示的操作畫面連到自己的 `127.0.0.1`；必須先開啟本機工具。GitHub 提供原始碼與下載包，影片不會經過本專案的雲端下載伺服器。

## 儲存位置與暫存

**瀏覽器模式（預設）**：成品由瀏覽器下載管理員儲存，另存提示、同名檔處理及最終位置依瀏覽器設定。網頁顯示取得影片及轉檔進度，瀏覽器下載清單顯示接收成品的進度。網頁無法確認你是否已完成另存。

處理好的檔案暫存在工具的 `data/browser-downloads`，可重試及供支援的瀏覽器部分內容續傳。暫存於關閉工具時清除；成品與暫存會短暫占用兩份空間。若只關分頁，沒有工作或正在傳送的檔案時，工具閒置約三分鐘會退出。

**直接存到指定資料夾**：預設使用工具內的 `Downloads`，可按「變更」選擇位置。成品直接存到該處，同名加上數字。此模式有開啟資料夾及顯示檔案的按鈕。

## 支援範圍與實測

目前處理公開、免登入、非直播的單支影片。平台改版、地區或帳號限制可能造成部分影片無法下載，不保證所有影片皆可用。Bilibili 僅列出當下免登入可取得的格式，此版不讀取帳號 Cookie。

2026-10-23 的實測包含三平台 MP4、Bilibili MP3、YouTube MP3、瀏覽器實際存檔、檔案完整解碼、取消及資料夾操作。4K60 實測為官方 Blender 影片開頭三秒片段；完整 8K 媒體未實測。

驗證資料：[`驗證摘要`](portable-downloader/驗證摘要.md)、[`瀏覽器儲存紀錄`](portable-downloader/evidence/browser-report.json)。只下載你有權儲存的內容，並遵守來源平台的適用條款。

## 回報問題

請在 [Issues](https://github.com/koviankevin/ClipPocket/issues) 提供版本、Windows 版本、來源平台、錯誤訊息和可公開的測試網址。請勿貼上 Cookie、權杖、私人影片連結或含個人資料的完整紀錄。

## 從原始碼執行

以下僅供開發者使用，Release 使用者不需要這些步驟。需要 Windows、PowerShell 7 與 .NET Framework 的 C# 編譯器。

```powershell
pwsh -File portable-downloader/prepare-runtime.ps1
./portable-downloader/ClipPocket.exe
```

準備腳本從官方固定版本下載執行元件，核對 SHA-256，並編譯啟動器。`app.cjs` 只使用 Node 內建模組。執行元件、下載內容與個人設定不提交到 Git。

使用 Node.js 24.19.0（與免安裝包準備腳本相同）執行不連外的測試，不需要安裝 npm 套件：

```powershell
node --test --test-reporter=tap --test-timeout=60000 portable-downloader/tests/quality.test.cjs portable-downloader/tests/browser-downloads.test.cjs portable-downloader/tests/updates.test.cjs portable-downloader/tests/pages-release.test.cjs
```

[`Windows offline regression`](.github/workflows/windows-offline-tests.yml) 在送往 `main` 的 PR 與推送到 `main` 時執行上述相同指令，使用 `windows-2025` x64 runner、固定 Node.js 版本及 Actions commit。Runner 映像仍由 GitHub 更新，執行紀錄會列出實際映像版本、Node.js 版本、PR 來源提交及實際測試提交（PR 預設為合併預覽提交），TAP 輸出保留通過／失敗／略過數量。每個測試檔逾時 60 秒、整個 job 上限 5 分鐘。

四支程式保留原有斷言，目前 Node test runner 共回報 **9 項**（畫質程式以一個測試檔計數、串流 1 項、更新 4 項、下載頁 3 項，並非 9 個畫質案例）。涵蓋來源畫質、4K／8K 選擇、直式／舊格式與無效輸入；本機 HTTP 完整內容與 Range 位元組比對、Unicode 檔名、重試、傳送中禁止清理及結束後回收；更新雜湊／大小校驗、錯誤清理及下載頁選版。串流測試只建立 256 KiB 與 16 MiB 本機暫存資料；更新與版本 API 使用假回應。

| 驗證層級 | 入口與環境 | CI 成功代表的範圍 |
| --- | --- | --- |
| Node.js 離線回歸 | 上述四支程式；Windows runner＋Node.js | 邏輯與本機 HTTP／檔案測試，沒有啟動真實瀏覽器或處理真實媒體。 |
| Windows 真實瀏覽器整合 | `tests/browser-flow.cjs` 等；Playwright、Edge、原生啟動器、yt-dlp、FFmpeg | 另行驗收實際存檔與解碼；不由離線 CI 結果推定。 |
| 免安裝 ZIP 驗證 | `tests/package-check.ps1`、`tests/update-package.cjs`；已建置 ZIP 與完整 Windows 執行環境 | 另行核對最終包的 SHA-256、啟動／更新；不由原始碼測試推定。 |
| 正式 Release 發布 | 下方「新版交付流程」 | 須另行打包、驗證及公開發布；此 CI 不建包、不發布。 |

一般 PR CI 不準備完整執行元件、不下載影片、不使用帳號 Cookie 或付費服務。現有真實瀏覽器／ZIP 驗收需要下載固定執行元件、編譯 Windows 啟動器／更新器，部分入口還會連線到影片平台並執行完整解碼，耗時與成功率受平台影響；本次保留獨立手動執行，未建立新的手動 Actions。既有 `evidence` 紀錄屬於當時本機驗收，不能當作本次 Windows runner 或新 ZIP 的結果。

瀏覽器整合測試另需 Playwright 1.62.1 及 Microsoft Edge；可用 `npm install --no-save playwright@1.62.1` 準備開發工具，再執行 `node portable-downloader/tests/browser-flow.cjs`。整合測試會實際連線下載公開影片，也會在本工具的資料夾內建立測試成品。打包前的測試及 SHA-256 核對完成後，執行 `pwsh -File portable-downloader/build-portable.ps1`。

## 授權與來源

ClipPocket 自有程式採 [MIT 授權](LICENSE)。隨附第三方元件保留各自授權，詳見 [元件說明](portable-downloader/THIRD_PARTY.md)、[對應來源與建置資料](THIRD_PARTY_SOURCES.md)及 `portable-downloader/licenses`。

本軟體使用 FFmpeg（GPLv3）。[v0.3.0 的固定來源附件](https://github.com/koviankevin/ClipPocket/releases/tag/v0.3.0)提供目前隨附 FFmpeg 的完整原始碼、建置配方及對應的相依原始碼快取，新版沿用相同執行元件時繼續使用這組來源；一般使用者不需下載來源附件。

## 下載頁的版本更新

### 新版交付流程

依專案使用者要求，每次交付工具新版時，都要一起完成 GitHub 下載版本與公開下載頁的更新。使用者明確要求只做本機、草稿或暫不發布時，依該次要求執行；只修改流程文件不需要另發工具版本。

1. 完成程式修改、版本號及相關測試，保留既有設定、下載紀錄與已儲存檔案。
2. 使用 `portable-downloader/build-portable.ps1` 建立免安裝 ZIP 與 `.sha256`，再以 `portable-downloader/tests/update-package.cjs` 驗證最終 ZIP；發佈的包必須與測試過的 SHA-256 一致。
3. 將對應程式碼推送至 GitHub。操作或功能有變動時，同步更新 `docs/index.html` 的教學與常見問題；版本、大小和下載連結繼續由 `docs/release.js` 讀取最新正式 Release。
4. 建立對應版本的 GitHub Release，附上 ZIP 與 `.sha256`，核對上傳附件的 SHA-256 後發布為正式版並指定 Latest，指向對應程式碼提交。隨附元件變更時，同步更新授權與對應來源資料。
5. 實際開啟公開下載頁，確認最新版本、大小、兩個下載按鈕及校驗碼連結均指向該次正式版；確認免安裝包可下載、操作說明已部署，並確認正式 Release 可供工具內建更新取得。
6. 回報 GitHub 版本與下載頁連結，以及已完成的驗證。若發布或部署未完成，明確指出未完成的部分，完成後才宣告整次更新交付完成。

下載頁每次開啟時，會透過公開 GitHub API 讀取最新正式 Release，自動更新版本、檔案大小、兩個下載按鈕及該檔案的校驗碼連結，不需要重新部署頁面。

發佈新版時，使用正式 Release（非草稿、非 prerelease），並附上打包腳本產生的 `ClipPocket-版本號-Windows-x64-portable.zip`；版本號須對應 Release tag（例如 tag `v0.4.0` 搭配 `ClipPocket-0.4.0-Windows-x64-portable.zip`），並依 GitHub 的 Latest 設定指定最新正式版。也支援固定附件名稱 `ClipPocket-Windows-x64-portable.zip`。校驗碼附件使用相同檔名再加 `.sha256`。

網站不放 GitHub 權杖，也不需要訪客登入。若 API 暫時受限、網路無法取得版本，或瀏覽器停用 JavaScript，下載入口會保留為 GitHub 最新正式版本頁；不會把舊包標成最新版。最新 Release 尚無 Windows 包時，會明確顯示提示。

## 工具內的自動更新

只在工具開啟時檢查（啟動時與每六小時），不建立背景服務、不需要 GitHub 登入或固定月費。更新僅接受本專案正式 Release 的 Windows x64 ZIP，使用 GitHub asset SHA-256 校驗完整下載，再核對所有包內檔案；這項校驗不等同 Windows 程式簽章。網路失敗不影響既有下載功能。

下載／轉檔或瀏覽器傳送中會阻擋更新。套用前先驗證整包，關閉本機程序後只替換清單列出的程式檔案；設定、已儲存影片及使用者自建檔案保留。替換或新版啟動失敗時嘗試還原原檔並重開，紀錄位於工具的 data/update-result.json。更新中請勿關機或移動工具；若還原也受磁碟或權限問題阻擋，會保留備份並顯示位置。

開發者：更新測試使用隔離的本機假版本，涵蓋成功更新、啟動失敗還原、校驗不符及保護設定資料夾，執行 node portable-downloader/tests/update-native.cjs。打包時 runtime-manifest.json 必須列出全部程式檔案、版本與 SHA-256；新版本需保持更新協定相容。


更新按鈕的範圍驗證（基準須為原驗收時的提交，可用 CLIPPOCKET_BASELINE 指定）：node portable-downloader/tests/update-feedback.cjs --browser --record-reuse。只有測試證明媒體流程、原生執行元件及更新套用邏輯與基準提交完全相同，才可用 build-portable.ps1 -UpdateFeedbackOnly 沿用 browser-report 與 update-report；原報告保留原受測版本，沿用依據與當前來源雜湊記錄在 evidence/update-feedback-report.json。其他打包關卡及最終 ZIP 測試照常執行，預設完整驗證入口保留。

(function () {
  'use strict';

  const REPOSITORY = 'https://github.com/koviankevin/ClipPocket';
  const LATEST = REPOSITORY + '/releases/latest';
  const ENDPOINT = 'https://api.github.com/repos/koviankevin/ClipPocket/releases/latest';

  function assetUrl(asset, tag) {
    if (!asset || asset.state !== 'uploaded' || !Number.isSafeInteger(asset.size) || asset.size <= 0) return null;
    const expected = REPOSITORY + '/releases/download/' + encodeURIComponent(tag) + '/' + encodeURIComponent(asset.name);
    // Accept only this project's GitHub attachment URLs, never arbitrary URLs
    // from external data. Names and versions are rendered as text below.
    return asset.browser_download_url === expected ? expected : null;
  }

  function releaseInfo(release) {
    if (!release || release.draft !== false || release.prerelease !== false ||
        typeof release.tag_name !== 'string' || !release.tag_name.trim() || release.tag_name.length > 100 ||
        !Array.isArray(release.assets)) throw Error('Invalid official release');
    const tag = release.tag_name;
    const version = tag.replace(/^v/i, '');
    const releaseUrl = REPOSITORY + '/releases/tag/' + encodeURIComponent(tag);
    const candidates = release.assets.filter(asset => {
      const match = typeof asset.name === 'string' && /^ClipPocket-(.+)-Windows-x64-portable\.zip$/i.exec(asset.name);
      return match && match[1].replace(/^v/i, '') === version && assetUrl(asset, tag);
    });
    // Also support a future stable filename without an embedded version.
    const portable = candidates[0] || release.assets.find(asset => asset.name === 'ClipPocket-Windows-x64-portable.zip' && assetUrl(asset, tag));
    if (!portable) return { version: tag, releaseUrl, downloadUrl: null, checksumUrl: null };
    const checksum = release.assets.find(asset => asset.name === portable.name + '.sha256' && assetUrl(asset, tag));
    return {
      version: tag, releaseUrl, downloadUrl: assetUrl(portable, tag), name: portable.name,
      bytes: portable.size, checksumUrl: checksum ? assetUrl(checksum, tag) : null
    };
  }

  function formatSize(bytes) {
    const gb = bytes >= 1e9;
    const number = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: gb || bytes < 1e7 ? 1 : 0 });
    return number.format(bytes / (gb ? 1e9 : 1e6)) + (gb ? ' GB' : ' MB');
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { releaseInfo, formatSize };
    return;
  }

  const all = selector => document.querySelectorAll(selector);
  let checking = false, lastAttempt = 0;

  function updateLinks(info) {
    all('.download-link').forEach(link => { link.href = info.downloadUrl || info.releaseUrl; });
    all('[data-download-label]').forEach(label => { label.textContent = info.downloadUrl ? '下載 Windows 免安裝版' : '前往 GitHub 下載最新版'; });
    all('[data-release-link]').forEach(link => { link.href = info.releaseUrl; });
    all('[data-checksum-link]').forEach(link => {
      link.href = info.checksumUrl || info.releaseUrl;
      link.textContent = info.checksumUrl ? '檔案校驗碼 ↗' : '查看發佈資訊 ↗';
    });
  }

  async function refresh() {
    if (checking) return;
    checking = true;
    lastAttempt = Date.now();
    document.documentElement.dataset.releaseState = 'loading';
    updateLinks({ releaseUrl: LATEST, downloadUrl: null, checksumUrl: null });
    all('[data-release-meta]').forEach(meta => { meta.textContent = '正在確認最新正式版本…'; });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(ENDPOINT, {
        headers: { Accept: 'application/vnd.github+json' },
        credentials: 'omit', cache: 'no-store', signal: controller.signal
      });
      if (!response.ok) throw Error('Release unavailable');
      const info = releaseInfo(await response.json());
      updateLinks(info);
      all('[data-release-meta]').forEach(meta => {
        meta.textContent = info.downloadUrl
          ? info.version + ' · 約 ' + formatSize(info.bytes) + ' · 64 位元 ZIP'
          : info.version + ' · Windows 免安裝包尚未提供，請查看發佈頁。';
      });
      document.documentElement.dataset.releaseState = info.downloadUrl ? 'ready' : 'unavailable';
    } catch {
      // Keep a useful latest-release page when API access is unavailable.
      // Never leave a stale version's direct link or embed a credential.
      updateLinks({ releaseUrl: LATEST, downloadUrl: null, checksumUrl: null });
      all('[data-release-meta]').forEach(meta => { meta.textContent = '暫時無法確認版本，請到 GitHub 取得最新正式版本。'; });
      document.documentElement.dataset.releaseState = 'fallback';
    } finally {
      clearTimeout(timer);
      checking = false;
    }
  }

  refresh();
  // Recheck a restored page or a long-idle tab, without background polling.
  const recheck = () => { if (!document.hidden && Date.now() - lastAttempt > 60000) refresh(); };
  document.addEventListener('visibilitychange', recheck);
  window.addEventListener('pageshow', recheck);
}());

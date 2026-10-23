'use strict';

function isVideo(format) {
  return format.vcodec !== 'none' && format.ext !== 'mhtml' && !format.has_drm
    && typeof format.url === 'string' && /^[\w.-]+$/.test(format.format_id || '')
    && (Number(format.height) > 0 || Number(format.width) > 0);
}

function dimensions(format) {
  const width = Number(format.width) || 0;
  const height = Number(format.height) || 0;
  return { width, height, resolution: width && height ? Math.min(width, height) : height || width };
}

function qualityOptions(info) {
  const groups = new Map();
  for (const format of info.formats || []) {
    if (!isVideo(format)) continue;
    const { width, height, resolution } = dimensions(format);
    const fps = Math.round(Number(format.fps) || 0);
    const id = `q-${resolution}-${fps}`;
    if (!groups.has(id)) {
      let label = `${resolution}p`;
      if (resolution === 2160) label += '（4K）';
      if (resolution === 4320) label += '（8K）';
      if (fps) label += ` · ${fps}fps`;
      if (height > width && width) label += ' · 直式';
      groups.set(id, { id, label, resolution, fps, width, height });
    }
  }
  return [...groups.values()].sort((a, b) => b.resolution - a.resolution || b.fps - a.fps);
}

function outputRequest(input) {
  if (!['mp4', 'mp3'].includes(input.format)) throw Error('請選擇 MP4 或 MP3。');
  const mode = input.mode || 'compatible';
  if (!['compatible', 'original'].includes(mode)) throw Error('影片模式無效。');
  let quality = input.quality || 'best';
  // Keep older clients and the original integration checks working.
  if (input.quality === undefined && input.height !== undefined) {
    const cap = Number(input.height);
    if (!Number.isInteger(cap) || cap < 1 || cap > 16384) throw Error('畫質無效。');
    quality = `cap-${cap}`;
  }
  if (typeof quality !== 'string' || !/^(best|q-\d{1,5}-\d{1,3}|cap-\d{1,5})$/.test(quality)) {
    throw Error('畫質無效。');
  }
  return { format: input.format, mode, quality };
}

function selectQuality(info, request) {
  const options = qualityOptions(info);
  let selected;
  if (request.quality === 'best') selected = options[0];
  else if (request.quality.startsWith('cap-')) {
    selected = options.find(option => option.resolution <= Number(request.quality.slice(4)));
  } else selected = options.find(option => option.id === request.quality);
  if (!selected) {
    if (!options.length && request.quality === 'best') {
      return { option: { id: 'best', label: '來源預設' }, selector: 'bv+ba/b' };
    }
    throw Error('這個畫質目前無法下載，請重新讀取影片資訊。');
  }
  const matches = (info.formats || []).map((format, index) => ({ ...format, index }))
    .filter(format => isVideo(format)
      && dimensions(format).resolution === selected.resolution
      && Math.round(Number(format.fps) || 0) === selected.fps);
  const rank = format => {
    const compatible = request.mode === 'compatible' && /^(avc|h264)/i.test(format.vcodec || '');
    const direct = ['https', 'http'].includes(format.protocol);
    return (compatible ? 1e6 : 0) + (direct ? 1e5 : 0) + format.index;
  };
  matches.sort((a, b) => rank(b) - rank(a));
  // Every alternative stays at the selected resolution and frame rate.
  const selector = matches.map(format => format.acodec === 'none'
    ? `${format.format_id}+ba[ext=m4a]/${format.format_id}+ba/${format.format_id}`
    : format.format_id).join('/');
  return { option: selected, selector };
}

module.exports = { qualityOptions, outputRequest, selectQuality };

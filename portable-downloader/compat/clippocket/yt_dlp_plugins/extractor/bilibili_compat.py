"""Small compatibility bridge for Bilibili's missing page initial state.

Uses the same signed public detail API as upstream yt-dlp. This does not
provide authentication or unlock restricted formats. Related upstream fix:
https://github.com/yt-dlp/yt-dlp/pull/17898
"""

from yt_dlp.extractor.bilibili import BiliBiliIE
from yt_dlp.utils import ExtractorError


class BiliBiliCompatIE(BiliBiliIE, plugin_name='clippocket_compat'):
    _VALID_URL = r'https?://(?:www\.)?bilibili\.com/(?:[a-z]{2}(?:-[A-Za-z]+)?/)?(?:video/|festival/[^/?#]+\?(?:[^#]*&)?bvid=)(?P<prefix>[aAbB][vV])(?P<id>[^/?#&]+)'

    def _real_extract(self, url):
        self._clippocket_source_url = url
        return super()._real_extract(url)

    def _search_json(self, start_pattern, string, name, video_id, *args, **kwargs):
        result = super()._search_json(start_pattern, string, name, video_id, *args, **kwargs)
        if name != 'initial state' or result or not getattr(self, '_clippocket_source_url', None):
            return result

        match = self._match_valid_url(self._clippocket_source_url)
        prefix = match.group('prefix').upper()
        query = {'platform': 'web'}
        query['bvid' if prefix == 'BV' else 'aid'] = prefix + match.group('id') if prefix == 'BV' else match.group('id')
        response = self._download_json(
            'https://api.bilibili.com/x/web-interface/wbi/view/detail',
            video_id, note='Reading public video details (ClipPocket compatibility)',
            query=self._sign_wbi(query, video_id),
            headers={'Referer': 'https://www.bilibili.com/', 'Origin': 'https://www.bilibili.com'},
        )
        if response.get('code', 0) != 0:
            raise ExtractorError('Bilibili: ' + str(response.get('message', 'Video details unavailable')), expected=True)
        detail = response.get('data') or {}
        video = detail.get('View')
        if not isinstance(video, dict) or not video.get('bvid'):
            raise ExtractorError('Bilibili did not return public video details', expected=True)
        return {'videoData': video, 'upData': video.get('owner') or {}, 'tags': detail.get('Tags') or []}

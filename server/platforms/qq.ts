import { XMLParser } from 'fast-xml-parser'
import { Platform } from '.'

const APIUtils = {
  toIdOrMid: (idOrMid: string, prefix: string) => (isNumber(idOrMid) ? { [`${prefix}id`]: idOrMid } : { [`${prefix}mid`]: idOrMid }),
  formRequest: (params: any) => ({
    method: 'POST',
    headers: { 
      'Content-Type': 'application/x-www-form-urlencoded',
      'Referer': 'https://y.qq.com/',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    },
    body: new URLSearchParams({ ...params, format: 'json', platform: 'yqq' }),
  }),
}

function cleanQqLyric(text: string): string {
  if (!text) return ''
  return text
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/(\[\d{1,3}:\d{1,2}(?:[.:]\d{1,5})?\])\s*\/\/\s*$/gm, '$1')
}

const API = {
  song: async (idOrMid: string) => fetchJson(`https://c.y.qq.com/v8/fcg-bin/fcg_play_single_song.fcg`, APIUtils.formRequest(APIUtils.toIdOrMid(idOrMid, 'song'))),
  lyrics: async (id: string) =>
    fetch(`https://c.y.qq.com/qqmusic/fcgi-bin/lyric_download.fcg`, APIUtils.formRequest({ musicid: id, version: '15', miniversion: '82', lrctype: '4' }))
      .then((r) => r.text())
      .then((xml) => new XMLParser().parse(xml.replace('<!--', '').replace('-->', '').replace(/<miniversion.*\/>/, ''))),
  
  lyric: async (mid?: string, id?: string) => {
    const query = new URLSearchParams({
      format: 'json',
      inCharset: 'utf8',
      outCharset: 'utf-8',
      ...(mid ? { songmid: mid } : {}),
      ...(id ? { musicid: String(id) } : {}),
    })
    return fetchJson(`https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?${query.toString()}`, {
      headers: {
        Referer: 'https://y.qq.com/',
        Origin: 'https://y.qq.com',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
    }).then((data: any) => {
      if (typeof data === 'string') {
        const match = data.match(/\{[\s\S]*\}/)
        if (match) {
          try { data = JSON.parse(match[0]) } catch {}
        }
      }

      const decode = (value: unknown) => {
        if (!value || typeof value !== 'string') return ''
        try {
          // QQ sometimes returns plain LRC/XML instead of base64.
          const decoded = Buffer.from(value, 'base64').toString('utf-8')
          const looksLikeBase64Lyric = /(?:\[\d{1,3}:\d{1,2}(?:[.:]\d{1,5})?\]|<QrcInfos|LyricContent)/.test(decoded)
          return cleanQqLyric(looksLikeBase64Lyric ? decoded : value)
        } catch {
          return cleanQqLyric(value)
        }
      }

      return {
        lyric: decode(data?.lyric),
        trans: decode(data?.trans || data?.tlyric),
      }
    })
  },
  album: async (idOrMid: string) => fetchJson(`https://c.y.qq.com/v8/fcg-bin/fcg_v8_album_detail_cp.fcg`, APIUtils.formRequest({ ...APIUtils.toIdOrMid(idOrMid, 'album'), newsong: 1 })),
  playlist: async (id: string) => fetchJson(`https://c.y.qq.com/v8/fcg-bin/fcg_v8_playlist_cp.fcg`, APIUtils.formRequest({ id, newsong: 1 })),
  
  // 增强中文搜索：完善请求头与参数，防止中文在海外节点被拦截
  musicu: async (keyword: string, pn: number = 1, ps: number = 50) =>
    fetchJson(`https://u.y.qq.com/cgi-bin/musicu.fcg`, {
      method: 'POST',
      headers: {
        'Referer': 'https://y.qq.com/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Content-Type': 'application/json;charset=utf-8'
      },
      body: JSON.stringify({
        comm: { ct: 19, cv: 1845, uin: 0 },
        req_1: {
          method: 'DoSearchForQQMusicDesktop',
          module: 'music.search.SearchCgiService',
          param: { num_per_page: ps, page_num: pn, query: keyword, search_type: '1' },
        },
      }),
    }),
  imageUrl: (mid?: string, type: string = '002') => (mid ? `https://y.qq.com/music/photo_new/T${type}R300x300M000${mid}.jpg?max_age=2592000` : ''),
}

const convertSong = (song: any): Song => ({
  platform: 'qq',
  platformId: song.id,
  name: song.name,
  alias: song.subtitle || (song.name != song.title ? song.title.slice(song.name.length).trim() : ''),
  title: song.name,
  album: song.album?.name,
  cover: API.imageUrl(song.album?.mid) || API.imageUrl(song?.vs?.at(1), '062') || API.imageUrl(song?.singer?.at(0)?.mid, '001'),
  artists: song.singer?.map((s: any) => s.name),
})

const qq: Platform = {
  search: async function (keyword: string): Promise<SearchResult> {
    const data = await API.musicu(keyword)
    const list = data.req_1?.data?.body?.song?.list || []
    return {
      songs: list.map(convertSong),
    }
  },
  getSongById: async function (idOrMid: string): Promise<Song & { mid: string }> {
    const data = await API.song(idOrMid)
    return {
      ...convertSong(data.data[0]),
      mid: data.data[0].mid,
    }
  },
  getAlbumById: async function (idOrMid: string): Promise<WithSongs<Album>> {
    const { data } = await API.album(idOrMid)
    return {
      name: data.getAlbumInfo.Falbum_name,
      alias: data.getAlbumInfo.Fother_name,
      artists: [
        ...new Set(
          [
            data.getAlbumInfo.Fsinger_all,
            ...(data.getSongInfo?.map((i: any) => (i.singer as any[]).map((s) => s.name)).flat() || []),
          ].filter(Boolean)
        ),
      ],
      cover: API.imageUrl(data.getAlbumInfo.Falbum_mid),
      description: data.getAlbumDesc.Falbum_desc,
      songs: data.getSongInfo.map(convertSong),
      songsTotal: data.getSongidsFromAlbumid?.length || -1,
    }
  },
  getPlaylistById: async function (id: string): Promise<WithSongs<Playlist>> {
    const { data } = await API.playlist(id)
    const l = data.cdlist[0]
    return {
      name: l.dissname,
      creator: l.nickname,
      cover: l.logo,
      description: l.des,
      songs: l.songlist.map(convertSong),
      songsTotal: l.total_song_num,
    }
  },
  getLyricsBySongId: async function (idOrMid: string): Promise<Lyrics> {
    let id = isNumber(idOrMid) ? idOrMid : ''
    let mid = isNumber(idOrMid) ? '' : idOrMid

    try {
      const songInfo = await this.getSongById(idOrMid)
      id = id || String(songInfo.platformId || '')
      mid = mid || songInfo.mid || ''
    } catch (e) {
      console.warn('获取 QQ 音乐单曲详情失败:', e)
    }

    const [standardRes, qrcData] = await Promise.allSettled([
      API.lyric(mid, id),
      id ? API.lyrics(id) : Promise.reject('no id'),
    ])

    const stdLyric = standardRes.status === 'fulfilled' && standardRes.value.lyric
      ? Lrc.from(standardRes.value.lyric).format()
      : ''
    const stdTrans = standardRes.status === 'fulfilled' && standardRes.value.trans
      ? Lrc.from(standardRes.value.trans).format()
      : ''

    let qrcOriginal = ''
    let qrcTrans = ''
    let qrcRoma = ''

    if (qrcData.status === 'fulfilled' && qrcData.value) {
      try {
        const root = (Object.values(qrcData.value) as any)[0]
        const cmd = Array.isArray(root?.cmd) ? root.cmd[0] : root?.cmd
        const lyricHexs = cmd?.lyric || {}

        if (Array.isArray(lyricHexs)) {
          for (const item of lyricHexs) {
            if (item?.content && !qrcOriginal) qrcOriginal = Qrc.fromHex(item.content).format()
            if (item?.contentts && !qrcTrans) qrcTrans = cleanQqLyric(Qrc.fromHex(item.contentts, false).format())
            if (item?.contentroma && !qrcRoma) qrcRoma = Qrc.fromHex(item.contentroma).format()
          }
        } else {
          if (lyricHexs.content) qrcOriginal = Qrc.fromHex(lyricHexs.content).format()
          if (lyricHexs.contentts) qrcTrans = cleanQqLyric(Qrc.fromHex(lyricHexs.contentts, false).format())
          if (lyricHexs.contentroma) qrcRoma = Qrc.fromHex(lyricHexs.contentroma).format()
        }
      } catch (e) {
        console.warn('QRC 解析失败:', e)
      }
    }

    const pickMoreComplete = (a: string, b: string) => {
      const aLines = a ? a.trim().split('\n').filter(Boolean).length : 0
      const bLines = b ? b.trim().split('\n').filter(Boolean).length : 0
      return aLines >= bLines ? a : b
    }

    return {
      original: pickMoreComplete(stdLyric, qrcOriginal),
      translation: pickMoreComplete(stdTrans, qrcTrans),
      romanization: qrcRoma,
    }
  },
}
export default qq

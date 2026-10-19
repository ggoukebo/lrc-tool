import { XMLParser } from 'fast-xml-parser'
import { Platform } from '.'

const APIUtils = {
  toIdOrMid: (idOrMid: string, prefix: string) => (isNumber(idOrMid) ? { [`${prefix}id`]: idOrMid } : { [`${prefix}mid`]: idOrMid }),
  formRequest: (params: any) => ({
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...params, format: 'json', platform: 'yqq' }),
  }),
}

// 解码 QQ 音乐标准歌词中常见的 HTML 实体（如 &apos; &#39; &quot; &amp;）
function decodeHtmlEntities(text: string): string {
  if (!text) return ''
  return text
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
}

const API = {
  song: async (idOrMid: string) => fetchJson(`https://c.y.qq.com/v8/fcg-bin/fcg_play_single_song.fcg`, APIUtils.formRequest(APIUtils.toIdOrMid(idOrMid, 'song'))),
  lyrics: async (id: string) =>
    fetch(`https://c.y.qq.com/qqmusic/fcgi-bin/lyric_download.fcg`, APIUtils.formRequest({ musicid: id, version: '15', miniversion: '82', lrctype: '4' }))
      .then((r) => r.text())
      .then((xml) => new XMLParser().parse(xml.replace('<!--', '').replace('-->', '').replace(/<miniversion.*\/>/, ''))),
  // 标准 LRC 接口：同时提取 lyric (原文) 和 trans (翻译)
  lyric: async (mid: string) =>
    fetchJson(`https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid=${mid}&format=json`, {
      headers: { Referer: 'https://y.qq.com/' },
    }).then((data) => ({
      lyric: data?.lyric ? decodeHtmlEntities(Buffer.from(data.lyric, 'base64').toString('utf-8')) : '',
      trans: data?.trans ? decodeHtmlEntities(Buffer.from(data.trans, 'base64').toString('utf-8')) : '',
    })),
  album: async (idOrMid: string) => fetchJson(`https://c.y.qq.com/v8/fcg-bin/fcg_v8_album_detail_cp.fcg`, APIUtils.formRequest({ ...APIUtils.toIdOrMid(idOrMid, 'album'), newsong: 1 })),
  playlist: async (id: string) => fetchJson(`https://c.y.qq.com/v8/fcg-bin/fcg_v8_playlist_cp.fcg`, APIUtils.formRequest({ id, newsong: 1 })),
  musicu: async (keyword: string, pn: number = 1, ps: number = 50) =>
    fetchJson(`https://u.y.qq.com/cgi-bin/musicu.fcg`, {
      method: 'POST',
      body: JSON.stringify({
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
    return {
      songs: data.req_1?.data.body.song.list.map(convertSong),
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
    const songInfo = await this.getSongById(idOrMid)
    const id = isNumber(idOrMid) ? idOrMid : songInfo.platformId
    const mid = songInfo.mid

    // 并行请求：1. 标准 LRC 接口 (最稳定完整)  2. QRC 加密接口 (包含罗马音)
    const [standardRes, qrcData] = await Promise.allSettled([
      API.lyric(mid),
      API.lyrics(id),
    ])

    const stdLyric = standardRes.status === 'fulfilled' ? Lrc.from(standardRes.value.lyric).format() : ''
    const stdTrans = standardRes.status === 'fulfilled' ? Lrc.from(standardRes.value.trans).format() : ''

    let qrcOriginal = ''
    let qrcTrans = ''
    let qrcRoma = ''

    if (qrcData.status === 'fulfilled' && qrcData.value) {
      try {
        const root = (Object.values(qrcData.value) as any)[0]
        const cmd = Array.isArray(root?.cmd) ? root.cmd[0] : root?.cmd
        const lyricHexs = cmd?.lyric || {}
        qrcOriginal = Qrc.fromHex(lyricHexs.content).format()
        qrcTrans = Qrc.fromHex(lyricHexs.contentts, false).format()
        qrcRoma = Qrc.fromHex(lyricHexs.contentroma).format()
      } catch (e) {
        console.warn('QRC 解析失败，使用标准 LRC 歌词:', e)
      }
    }

    // 优先对比行数：谁更完整用谁（彻底解决 QRC 解析漏行导致歌词不全的问题）
    const pickMoreComplete = (a: string, b: string) => {
      const aLines = a ? a.split('\n').length : 0
      const bLines = b ? b.split('\n').length : 0
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

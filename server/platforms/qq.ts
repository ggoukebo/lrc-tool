import { XMLParser } from 'fast-xml-parser'
import type { Platform } from '.'

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

const QQ_SEARCH_PAGE_SIZE = 30
const QQ_SEARCH_CACHE_TTL = 5 * 60 * 1000
const QQ_SEARCH_CACHE_LIMIT = 100
const QQ_SEARCH_TIMEOUT = 10 * 1000
const qqSearchCache = new Map<string, { expiresAt: number; songs: Song[] }>()

function normalizeSearchKeyword(keyword: unknown): string {
  if (typeof keyword !== 'string') return ''
  return keyword
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function createSearchId(): string {
  const timestamp = String(Date.now()).slice(-8)
  const random = String(Math.floor(Math.random() * 1e8)).padStart(8, '0')
  return `${timestamp}${random}`
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(String(value), 10)
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, min), max) : fallback
}

function pickString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
}

function getSongArtists(song: any): string[] {
  const values = [song?.singer, song?.singers, song?.singerName]
  const artists: string[] = []

  const addArtist = (value: unknown) => {
    if (typeof value === 'string') {
      if (value.trim()) artists.push(value.trim())
      return
    }
    if (value && typeof value === 'object') {
      const name = pickString((value as any).name, (value as any).title)
      if (name) artists.push(name)
    }
  }

  for (const value of values.flatMap((item) => (Array.isArray(item) ? item : [item]))) {
    addArtist(value)
  }
  return [...new Set(artists)]
}

function getMusicuSearchTracks(data: any): any[] {
  const requestEntries = Object.entries(data ?? {}).filter(
    ([key, value]) => key.startsWith('req') && value && typeof value === 'object'
  )
  const entries = requestEntries.length
    ? requestEntries
    : [['response', data] as const]

  const tracks: any[] = []
  const errors: string[] = []
  let hasSuccessfulResponse = false

  for (const [name, value] of entries) {
    const response = value as any
    const songList = response?.data?.body?.song?.list
    const itemSongs = response?.data?.body?.item_song
    const responseSongs = [
      ...(Array.isArray(songList) ? songList : songList ? [songList] : []),
      ...(Array.isArray(itemSongs) ? itemSongs : itemSongs ? [itemSongs] : []),
    ]
    const codeValues = [response?.code, response?.data?.code, response?.data?.body?.code]
      .filter((code) => code !== undefined && code !== null && code !== '')
      .map(Number)
      .filter(Number.isFinite)
    const code = codeValues.find((value) => value !== 0) ?? codeValues[0]

    if (responseSongs.length) tracks.push(...responseSongs)
    if (code === 0 || responseSongs.length) hasSuccessfulResponse = true
    else if (code !== undefined) errors.push(`${name}: ${code}`)
  }

  if (tracks.length) return tracks
  if (hasSuccessfulResponse) return []
  if (errors.length) throw new Error(`QQ 音乐搜索接口错误 (${errors.join(', ')})`)
  throw new Error('QQ 音乐搜索响应缺少歌曲数据')
}

function getLegacySearchTracks(data: any): any[] {
  const songList = data?.data?.song?.list ?? data?.song?.list
  if (Array.isArray(songList)) return songList

  const codeValue = data?.code ?? data?.data?.code
  if (Number(codeValue) === 0) return []
  throw new Error(`QQ 音乐备用搜索响应异常${codeValue === undefined ? '' : ` (${codeValue})`}`)
}

function getCachedSearch(query: string): Song[] | undefined {
  const entry = qqSearchCache.get(query)
  if (!entry) return
  if (entry.expiresAt <= Date.now()) {
    qqSearchCache.delete(query)
    return
  }
  return entry.songs
}

function cacheSearch(query: string, songs: Song[]) {
  qqSearchCache.delete(query)
  if (qqSearchCache.size >= QQ_SEARCH_CACHE_LIMIT) {
    const oldestKey = qqSearchCache.keys().next().value
    if (oldestKey) qqSearchCache.delete(oldestKey)
  }
  qqSearchCache.set(query, { expiresAt: Date.now() + QQ_SEARCH_CACHE_TTL, songs })
}

function cloneSongs(songs: Song[]): Song[] {
  return songs.map((song) => ({
    ...song,
    artists: song.artists ? [...song.artists] : undefined,
  }))
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

function parseQrcPayload(value: string, isXml: boolean = true): string {
  if (!value) return ''
  const trimmed = value.trim()
  if (/^[0-9a-fA-F]+$/.test(trimmed) && trimmed.length > 64) {
    return cleanQqLyric(Qrc.fromHex(trimmed, isXml).format())
  }
  if (trimmed.includes('<QrcInfos') || trimmed.includes('LyricContent')) {
    return cleanQqLyric(Qrc.fromHex(trimmed, true).format())
  }
  return cleanQqLyric(Lrc.from(trimmed).format())
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
  
  musicu: async (keyword: string, pn: number = 1, ps: number = QQ_SEARCH_PAGE_SIZE) => {
    const page = boundedInteger(pn, 1, 1, 100)
    const pageSize = boundedInteger(ps, QQ_SEARCH_PAGE_SIZE, 1, 50)
    return fetchJson(`https://u.y.qq.com/cgi-bin/musicu.fcg`, {
      method: 'POST',
      headers: {
        'Referer': 'https://y.qq.com/',
        'Origin': 'https://y.qq.com',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Content-Type': 'application/json;charset=utf-8',
      },
      signal: AbortSignal.timeout(QQ_SEARCH_TIMEOUT),
      body: JSON.stringify({
        comm: {
          ct: 19,
          cv: 1873,
          uin: '0',
          format: 'json',
          inCharset: 'utf8',
          outCharset: 'utf-8',
          notice: 0,
          platform: 'yqq.json',
          needNewCode: 0,
        },
        req_0: {
          method: 'DoSearchForQQMusicMobile',
          module: 'music.search.SearchCgiService',
          param: {
            query: keyword,
            remoteplace: 'txt.mqq.all',
            search_type: 0,
            searchid: createSearchId(),
            page_num: page,
            num_per_page: pageSize,
          },
        },
      }),
    })
  },
  legacySearch: async (keyword: string, pn: number = 1, ps: number = QQ_SEARCH_PAGE_SIZE) => {
    const query = new URLSearchParams({
      ct: '24',
      qqmusic_ver: '1298',
      new_json: '1',
      remoteplace: 'txt.yqq.song',
      searchid: createSearchId(),
      t: '0',
      aggr: '1',
      cr: '1',
      catZhida: '1',
      lossless: '0',
      flag_qc: '0',
      p: String(boundedInteger(pn, 1, 1, 100)),
      n: String(boundedInteger(ps, QQ_SEARCH_PAGE_SIZE, 1, 50)),
      w: keyword,
      g_tk: '5381',
      loginUin: '0',
      hostUin: '0',
      format: 'json',
      inCharset: 'utf8',
      outCharset: 'utf-8',
      notice: '0',
      platform: 'yqq.json',
      needNewCode: '0',
    })
    return fetchJson(`https://c.y.qq.com/soso/fcgi-bin/client_search_cp?${query.toString()}`, {
      headers: {
        'Referer': 'https://y.qq.com/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
      signal: AbortSignal.timeout(QQ_SEARCH_TIMEOUT),
    })
  },
  imageUrl: (mid?: string, type: string = '002') => (mid ? `https://y.qq.com/music/photo_new/T${type}R300x300M000${mid}.jpg?max_age=2592000` : ''),
}

const convertSong = (song: any): Song => {
  const name = pickString(song?.name, song?.songname, song?.title)
  const title = pickString(song?.title, song?.name, song?.songname)
  const subtitle = pickString(song?.subtitle, song?.subtitleName)
  const inferredAlias = title && name && title !== name && title.startsWith(name)
    ? title.slice(name.length).replace(/^[\s\-–—:：()（）\[\]【】]+|[\s\-–—:：()（）\[\]【】]+$/g, '').trim()
    : ''
  const album = song?.album
  const albumName = pickString(
    typeof album === 'string' ? album : album?.name,
    song?.albumname,
    song?.albumName
  )
  const albumMid = pickString(
    typeof album === 'object' ? album?.mid : undefined,
    typeof album === 'object' ? album?.pmid : undefined,
    song?.albummid,
    song?.albumMid
  )
  const singers = Array.isArray(song?.singer) ? song.singer : []
  const artists = getSongArtists(song)

  return {
    platform: 'qq',
    platformId: pickString(song?.id, song?.songid, song?.mid, song?.songmid) || '',
    name,
    alias: subtitle || inferredAlias || undefined,
    title,
    album: albumName,
    cover: API.imageUrl(albumMid)
      || API.imageUrl(pickString(song?.vs?.[1]), '062')
      || API.imageUrl(pickString(singers[0]?.mid), '001'),
    artists: artists.length ? artists : undefined,
  }
}

function convertSearchTracks(tracks: any[]): Song[] {
  const songs: Song[] = []
  const seen = new Set<string>()

  for (const track of tracks) {
    const song = convertSong(track)
    if (!song.platformId || !song.name || seen.has(song.platformId)) continue
    seen.add(song.platformId)
    songs.push(song)
  }
  return songs
}

async function searchQqSongs(keyword: string): Promise<Song[]> {
  let primaryFinished = false
  let primaryError: unknown

  try {
    const data = await API.musicu(keyword, 1, QQ_SEARCH_PAGE_SIZE)
    const tracks = getMusicuSearchTracks(data)
    primaryFinished = true
    const songs = convertSearchTracks(tracks)
    if (songs.length) return songs
  } catch (error) {
    primaryError = error
  }

  let fallbackError: unknown
  try {
    const data = await API.legacySearch(keyword, 1, QQ_SEARCH_PAGE_SIZE)
    return convertSearchTracks(getLegacySearchTracks(data))
  } catch (error) {
    fallbackError = error
  }

  if (primaryFinished) return []

  const primaryMessage = primaryError instanceof Error ? primaryError.message : String(primaryError)
  const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
  throw new Error(`QQ 音乐搜索失败: ${primaryMessage}; 备用搜索: ${fallbackMessage}`)
}

const qq: Platform = {
  search: async function (keyword: string): Promise<SearchResult> {
    const query = normalizeSearchKeyword(keyword)
    if (!query) return { songs: [] }

    const cached = getCachedSearch(query)
    if (cached) return { songs: cloneSongs(cached) }

    const songs = await searchQqSongs(query)
    cacheSearch(query, songs)
    return { songs: cloneSongs(songs) }
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
      const songInfo = await this.getSongById(idOrMid) as Song & { mid?: string }
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
            if (item?.content && !qrcOriginal) qrcOriginal = parseQrcPayload(item.content)
            if (item?.contentts && !qrcTrans) qrcTrans = parseQrcPayload(item.contentts, false)
            if (item?.contentroma && !qrcRoma) qrcRoma = parseQrcPayload(item.contentroma)
          }
        } else {
          if (lyricHexs.content) qrcOriginal = parseQrcPayload(lyricHexs.content)
          if (lyricHexs.contentts) qrcTrans = parseQrcPayload(lyricHexs.contentts, false)
          if (lyricHexs.contentroma) qrcRoma = parseQrcPayload(lyricHexs.contentroma)
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

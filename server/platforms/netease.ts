import { Platform } from '.'
import { getMusicAToken, searchNeteaseEapi } from '../utils/netease-eapi'

const API = {
  songs: async (ids: string[]) => fetchJson(`https://music.163.com/api/song/detail?ids=[${ids.join(',')}]`),
  // /api/song/lyric/v1 is the newer endpoint. Keep the legacy endpoint as a
  // fallback because some NetEase nodes still return the old response shape.
  lyrics: async (songId: string) => {
    const urls = [
      `https://music.163.com/api/song/lyric/v1?ver=1&csrf_token=&id=${encodeURIComponent(songId)}&cp=false&lv=0&tv=0&rv=0&kv=0&yv=0&ytv=0&yrv=0`,
      `https://music.163.com/api/song/lyric?os=pc&lv=-1&kv=-1&tv=-1&rv=-1&id=${encodeURIComponent(songId)}`,
    ]

    let lastError: unknown
    for (const url of urls) {
      try {
        const data: any = await fetchJson(url)
        // Both endpoints normally expose lrc/tlyric/romalrc as { lyric: string }.
        // A few responses return the field directly as a string, so normalize
        // both forms here.
        const pick = (value: any) =>
          typeof value === 'string' ? value : value?.lyric || ''

        if (pick(data?.lrc) || pick(data?.tlyric) || pick(data?.romalrc)) {
          return data
        }
      } catch (error) {
        lastError = error
      }
    }

    throw lastError || new Error('获取网易云歌词失败')
  },
  album: async (albumId: string) => fetchJson(`https://music.163.com/api/v1/album/${albumId}`),
  playlist: async (playlistId: string) => fetchJson(`https://music.163.com/api/v6/playlist/detail?s=0&id=${playlistId}`),
}

const getAlias = (song: any): string => {
  const alias = song.transName || song.tns || song.alias
  return Array.isArray(alias) ? alias.join('/') : alias || ''
}

const convertSong = (song: any): Song => ({
  platform: 'netease',
  platformId: song.id,
  name: song.name,
  alias: getAlias(song),
  title: song.name,
  album: song.album?.name || song.al?.name,
  cover: song.album?.picUrl || song.al?.picUrl,
  artists: (song.artists as { name: string }[])?.map((s) => s.name) || song.ar?.map((s: any) => s.name),
})

const getSongsByIds = async (ids: string[]): Promise<Song[]> => (await Promise.all(Array.from({ length: Math.ceil(ids.length / 200) }, (_, i) => API.songs(ids.slice(i * 200, (i + 1) * 200)).then((data) => data.songs.map(convertSong))))).flat()

const netease: Platform = {
  search: async function (keyword: string): Promise<SearchResult> {
    const token = await getMusicAToken()
    const data = await searchNeteaseEapi(keyword, token)
    return {
      songs: (data.result?.songs || []).map(convertSong),
    }
  },
  getSongById: async function (id: string): Promise<Song> {
    return (await getSongsByIds([id]))[0]
  },
  getAlbumById: async function (id: string): Promise<WithSongs<Album>> {
    const data = await API.album(id)
    const songIds = data.songs?.map((s: any) => s.id)
    return {
      name: data.album?.name,
      alias: data.album?.alias.join('/'),
      artists: data.album?.artists.map((a: any) => a.name),
      cover: data.album?.picUrl,
      description: data.album?.description,
      songs: await getSongsByIds(songIds),
      songsTotal: songIds.length,
    }
  },
  getPlaylistById: async function (id: string): Promise<WithSongs<Playlist>> {
    const data = await API.playlist(id)
    const songIds = data.playlist?.trackIds.map((t: any) => t.id)
    return {
      name: data.playlist?.name,
      creator: data.playlist?.creator.nickname,
      cover: data.playlist?.coverImgUrl,
      description: data.playlist?.description,
      songs: await getSongsByIds(songIds),
      songsTotal: songIds.length,
    }
  },
  getLyricsBySongId: async function (id: string): Promise<Lyrics> {
    const data: any = await API.lyrics(id)
    const dataLrc = (key: string) => {
      const value = data?.[key]
      const lyric = typeof value === 'string' ? value : value?.lyric
      return lyric ? Lrc.from(lyric).format() : ''
    }

    return {
      original: dataLrc('lrc'),
      translation: dataLrc('tlyric'),
      romanization: dataLrc('romalrc'),
    }
  },
}
export default netease

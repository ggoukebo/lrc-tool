import CryptoJS from 'crypto-js'
import { constants, publicEncrypt } from 'node:crypto'

const EAPI_KEY = 'e82ckenh8dichen8'
const PRESET_KEY = '0CoJUm6Qyw8W8jud'
const IV = '0102030405060708'
const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDgtQn2JZ34ZC28NWYpAUd98iZ37BUrX/aKzmFbt7clFSs6sXqHauqKWqdtLkF2KexO40H1YTX8z2lSgBBOAxLsvaklV8k4cBFK9snQXE9/DDaFt6Rr7iVZMldczhC0JNgTz+SHXT6CBHuX3e9SdB1Ua44oncaTWz7OBGLbCiK45wIDAQAB
-----END PUBLIC KEY-----`
const BASE62 = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
const DEVICE_ID_KEY = '3go8&$8*3*3h0k(2)2'
const OSVER = 'Microsoft-Windows-10-Professional-build-19045-64bit'
const APPVER = '3.1.17.204416'

// 匿名 MUSIC_A 凭证，仅在自动注册失败时作为兜底；可设置环境变量 MUSIC_A 覆盖。
const FALLBACK_MUSIC_A = '002119AB66FDBA83DC1C01E59B039B527B18EB01A2171809DA2DF74ABC648D316202997B778FF3B8F9690D7A18AF16645475C0E10662EF58593F5DC84A36C77320510AA065AADE8D9FBE825F352BB9C8D2D7FAB76571811F740701B1910B99B296CDDCEE2329A1D6F8DC05ACA3AA389A08C25F66C404070FBDCEE64D9408EC89F8E114E3F9F1E186E3620305EB743C75C7DB16392A654BCC7402A532C6873E94CF1C04B6471C841C395AC3E2F039BA3F20E6FE9C399D3C238CC95380F47940306F348E97271D3EBF3714AC40DA2B7313FCF55B5DF27871F20F5C883A0760F94F699DED1ADC53FF654D7E8D47711A6ADAD0BFFE28CAD566125DA49F9A1C8E3930F36C42273840750D8581E7EF7E7F9DB0C1BB994A0B7E9D7F3D5CE2CADC48C4C5EE1D955555685A4F9A2D7687CD8C70A20F6E47440F85D9A6B2FD4E53EE53FF4CE54B644425D5465BB6244ED54AEAF573B88913327BF0E5997751FB96C7405FD7323A4A8D3FB80CCD970CE69578736258DAC106E70EF574EDFD35EC9109E12C279725E8E1E5FBC9608A8B97B6071538DB60C4ABCD62FEC7823AFF5059C0760017B127CE7EF007375EA6354FBDC13D8FF472B680AC32B20352200A5DDE6AD6D40CD64FDF3BE998E7A51537FF2DE151B23519DDB23583ADECF75D1A169FC32BD41C5B2A2C2814189323534CC5D6082047339D983F9D102128B412C88A0F981F018CC2CE10B764225F6E92F7EA1BB64D331C50'

let cachedMusicA: string | undefined

const aesCbcEncrypt = (text: string, key: string) =>
  CryptoJS.AES.encrypt(CryptoJS.enc.Utf8.parse(text), CryptoJS.enc.Utf8.parse(key), {
    iv: CryptoJS.enc.Utf8.parse(IV),
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7,
  }).toString()

const aesEcbEncryptHex = (text: string, key: string) =>
  CryptoJS.AES.encrypt(CryptoJS.enc.Utf8.parse(text), CryptoJS.enc.Utf8.parse(key), {
    mode: CryptoJS.mode.ECB,
    padding: CryptoJS.pad.Pkcs7,
  }).ciphertext.toString().toUpperCase()

const weapiEncrypt = (data: Record<string, unknown>) => {
  const text = JSON.stringify(data)
  const secretKey = Array.from({ length: 16 }, () => BASE62[Math.floor(Math.random() * BASE62.length)]).join('')
  return {
    params: aesCbcEncrypt(aesCbcEncrypt(text, PRESET_KEY), secretKey),
    encSecKey: publicEncrypt(
      { key: PUBLIC_KEY, padding: constants.RSA_PKCS1_PADDING },
      Buffer.from(secretKey.split('').reverse().join('')),
    ).toString('hex'),
  }
}

const eapiEncrypt = (url: string, data: Record<string, unknown>) => {
  const text = JSON.stringify(data)
  const digest = CryptoJS.MD5(`nobody${url}use${text}md5forencrypt`).toString()
  return aesEcbEncryptHex(`${url}-36cd479b6b5-${text}-36cd479b6b5-${digest}`, EAPI_KEY)
}

const generateDeviceId = () =>
  Array.from({ length: 52 }, () => '0123456789ABCDEF'[Math.floor(Math.random() * 16)]).join('')

const cloudmusicEncodeId = (deviceId: string) => {
  const xored = [...deviceId]
    .map((char, index) =>
      String.fromCharCode(char.charCodeAt(0) ^ DEVICE_ID_KEY.charCodeAt(index % DEVICE_ID_KEY.length)),
    )
    .join('')
  const digest = CryptoJS.enc.Base64.stringify(CryptoJS.MD5(CryptoJS.enc.Utf8.parse(xored)))
  return Buffer.from(`${deviceId} ${digest}`).toString('base64')
}

const randomChineseIp = () =>
  `116.${25 + Math.floor(Math.random() * 70)}.${1 + Math.floor(Math.random() * 254)}.${1 + Math.floor(Math.random() * 254)}`

const encodeCookie = (cookie: Record<string, string>) =>
  Object.entries(cookie)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('; ')

const baseCookie = (musicA: string) => ({
  osver: OSVER,
  deviceId: 'undefined',
  os: 'pc',
  appver: APPVER,
  versioncode: '140',
  mobilename: '',
  buildver: String(Math.floor(Date.now() / 1000)),
  resolution: '1920x1080',
  __csrf: '',
  channel: 'netease',
  requestId: `${Date.now()}_${String(Math.floor(Math.random() * 1000)).padStart(4, '0')}`,
  MUSIC_A: musicA,
})

export const registerAnonymous = async (): Promise<string> => {
  const deviceId = generateDeviceId()
  const nuid = CryptoJS.lib.WordArray.random(32).toString()
  const encrypted = weapiEncrypt({
    username: cloudmusicEncodeId(deviceId),
    csrf_token: '',
    e_r: false,
  })
  const ip = randomChineseIp()
  const cookie = encodeCookie({
    __remember_me: 'true',
    ntes_kaola_ad: '1',
    _ntes_nuid: nuid,
    _ntes_nnid: `${nuid},${Date.now()}`,
    WNMCID: `${Array.from({ length: 6 }, () => BASE62[Math.floor(Math.random() * BASE62.length)]).join('')}.${Date.now()}.01.0`,
    WEVNSM: '1.0.0',
    osver: OSVER,
    deviceId,
    os: 'pc',
    channel: 'netease',
    appver: APPVER,
    NMTID: CryptoJS.lib.WordArray.random(16).toString(),
    MUSIC_A: '',
  })

  const response = await fetch('https://music.163.com/weapi/register/anonimous', {
    method: 'POST',
    headers: {
      Accept: 'application/json, text/plain, */*',
      'Content-Type': 'application/x-www-form-urlencoded',
      Referer: 'https://music.163.com',
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0',
      'X-Real-IP': ip,
      'X-Forwarded-For': ip,
      Cookie: cookie,
    },
    body: new URLSearchParams({ params: encrypted.params, encSecKey: encrypted.encSecKey }),
  })

  const text = await response.text()
  let data: any = {}
  try {
    data = JSON.parse(text)
  } catch {}

  const token = String(data?.cookie || '').match(/(?:^|;)\s*MUSIC_A=([^;]+)/)?.[1]
  if (data?.code === 200 && token) return token
  throw new Error(`网易云匿名注册失败: ${text.slice(0, 80)}`)
}

export const getMusicAToken = async (): Promise<string> => {
  if (cachedMusicA) return cachedMusicA
  if (process.env.MUSIC_A) {
    cachedMusicA = process.env.MUSIC_A
    return cachedMusicA
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const token = await registerAnonymous()
      if (token) {
        cachedMusicA = token
        return token
      }
    } catch {}
  }

  cachedMusicA = FALLBACK_MUSIC_A
  return cachedMusicA
}

export const searchNeteaseEapi = async (keyword: string, musicA: string) => {
  const header = baseCookie(musicA)
  const data = {
    s: keyword,
    type: 1,
    limit: 50,
    offset: 0,
    total: true,
    e_r: false,
    header,
  }
  const params = eapiEncrypt('/api/cloudsearch/pc', data)
  const ip = randomChineseIp()
  const cookie = encodeCookie({
    ...header,
    NMTID: CryptoJS.lib.WordArray.random(16).toString(),
    _ntes_nuid: CryptoJS.lib.WordArray.random(32).toString(),
    _ntes_nnid: `${CryptoJS.lib.WordArray.random(32).toString()},${Date.now()}`,
    WNMCID: `${Array.from({ length: 6 }, () => BASE62[Math.floor(Math.random() * BASE62.length)]).join('')}.${Date.now()}.01.0`,
    WEVNSM: '1.0.0',
  })

  const response = await fetch('https://interface.music.163.com/eapi/cloudsearch/pc', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Safari/537.36 Chrome/91.0.4472.164 NeteaseMusicDesktop/3.0.18.203152',
      Cookie: cookie,
      'X-Real-IP': ip,
      'X-Forwarded-For': ip,
    },
    body: new URLSearchParams({ params }),
  })

  const text = await response.text()
  if (!response.ok) throw new Error(`网易云 EAPI 搜索失败: ${response.status}`)
  return JSON.parse(text)
}

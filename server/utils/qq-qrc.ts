import { decodeQrc } from './qq-des'
import { XMLParser } from 'fast-xml-parser'

export class Qrc extends Lrc {
  static fromHex(hex?: string, isXml: boolean = true) {
    if (!hex || hex.length <= 64) return new Qrc()
    const raw = decodeQrc(hex)
    if (!raw) return new Qrc()
    
    let lrcText = raw
    if (isXml || raw.includes('<QrcInfos') || raw.includes('LyricContent')) {
      try {
        const xmlClean = raw.replace(/<!--[\s\S]*?-->/g, '').trim()
        const data = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' }).parse(xmlClean)
        const extracted =
          data?.QrcInfos?.LyricInfo?.Lyric_1?.LyricContent ||
          data?.QrcInfos?.LyricInfo?.Lyric?.LyricContent
        if (extracted) {
          lrcText = extracted
        }
      } catch (e) {
        const match = raw.match(/LyricContent\s*=\s*"([\s\S]*?)"\s*\/?>/)
        if (match && match[1]) {
          lrcText = match[1]
        }
      }
    }

    return new QrcBuilder(lrcText).build()
  }
}

export class QrcBuilder extends LrcBuilder {
  constructor(raw: string) {
    super(raw || '')
    this.lineHandlers.unshift((line, lrc) => {
      const m = line.match(/^\[(\d+)\s*,\s*\d+\](.*)$/)
      if (!m) return
      const time = parseInt(m[1]!, 10) / 1000
      const lineContent = m[2] || ''

      let text = lineContent
        .replace(/\(\d+\s*,\s*\d+(?:\s*,\s*\d+)?\)/g, '')
        .replace(/<\d+\s*,\s*\d+(?:\s*,\s*\d+)?>/g, '')
        .trim()

      if (text === '//') {
        text = ''
      }

      const formattedRaw = `[${Lrc.formatTime(time)}]${text}`
      lrc.lines.push({ time, text, raw: formattedRaw })
      return true
    })
  }
}

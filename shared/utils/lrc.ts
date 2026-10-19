import subsrt from 'subsrt-ts'

export type LrcMeta = Record<string, string>
export type LrcLine = { time: number; text: string; raw: string }
export type LrcLineHandler = (line: string, ctx: Lrc) => boolean | void | undefined
export type LrcFormatConfig = { to?: string; meta: boolean }

export class Lrc {
  meta: LrcMeta = {}
  lines: LrcLine[] = []
  static from(raw?: string) {
    return raw ? new LrcBuilder(raw).build() : new Lrc()
  }
  static readonly FORMAT_TYPES = [...new Set(['lrc', 'srt', 'txt', ...subsrt.list().sort()])]
  static formatTime = (time: number) => {
    if (time === -1 || isNaN(time)) return ''
    const minutes = Math.floor(time / 60).toString().padStart(2, '0')
    const seconds = (time % 60).toFixed(2).padStart(5, '0')
    return `${minutes}:${seconds}`
  }
  format(config?: LrcFormatConfig): string {
    const { to = 'lrc', meta = false } = config || {}
    if (to === 'txt') {
      return this.lines.map(({ text }) => text).join('\n')
    }
    const lrc = [
      ...(meta ? Object.entries(this.meta).map(([k, v]) => `[${k}:${v}]`).concat('') : []).filter(Boolean),
      ...this.lines.map(({ time, text }) => {
        if (time == -1) return text
        return `[${Lrc.formatTime(time)}]${text}`
      }),
    ].join('\n')

    if (to === 'lrc') return lrc
    else return subsrt.convert(lrc, { from: 'lrc', to: to })
  }
  concat(that: Lrc | string, that_weight?: number) {
    if (typeof that === 'string') that = new LrcBuilder(that).build()
    type LrcLinesWithWeight = (LrcLine & { weight: number })[]
    const thisLines = (this.lines as LrcLinesWithWeight).map((line) => ({ ...line, weight: line.weight || 0 }))
    const thatLines = (that.lines as LrcLinesWithWeight).map((line) => ({ ...line, weight: that_weight || 0 }))
    thisLines.push(...thatLines)
    thisLines.sort((a, b) => {
      if (a.time !== b.time) {
        return a.time - b.time
      }
      return a.weight - b.weight
    })
    this.lines = thisLines
  }
}

export class LrcBuilder {
  private raw: string
  constructor(raw: string) {
    this.raw = raw
  }
  lineHandlers: LrcLineHandler[] = [
    // 1. 优先匹配带时间戳的歌词行（支持单行多个时间戳，如 [00:12.34][01:23.45]歌词）
    (line, lrc) => {
      const timeTagRegex = /\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,5})?)\]/g
      const matches = [...line.matchAll(timeTagRegex)]
      if (matches.length === 0) return

      // 移除所有时间标签以及 QRC/逐字时间标签（如 <00:12.34> 或 (123,456)），保留纯歌词文本
      const text = line
        .replace(timeTagRegex, '')
        .replace(/<\d{1,3}:\d{1,2}(?:[.:]\d{1,5})?>/g, '')
        .trim()

      for (const m of matches) {
        const minutes = parseInt(m[1]!, 10)
        // 将可能存在的冒号毫秒 (12:34) 统一替换为小数点 (12.34) 再转浮点数
        const seconds = parseFloat(m[2]!.replace(':', '.'))
        const time = minutes * 60 + seconds
        const formattedRaw = `[${Lrc.formatTime(time)}]${text}`
        lrc.lines.push({ time, text, raw: formattedRaw })
      }
      return true
    },
    // 2. 匹配顶部 Meta 标签（如 [ti:歌名]、[ar:歌手]，排除数字开头的时间戳）
    (line, lrc) => {
      const m = line.match(/^\[([a-zA-Z_]\w*):(.*)\]$/)
      if (!m) return
      lrc.meta[m[1]!] = m[2]!.trim()
      return true
    }
  ]
  handler(handler: LrcLineHandler) {
    this.lineHandlers.push(handler)
    return this
  }
  build() {
    const lrc = new Lrc()
    const lines = this.raw.split(/\r?\n/)
    lines.forEach((line) => {
      if (!line.trim()) return
      let handled = false
      for (const handler of this.lineHandlers) {
        if (handler(line, lrc)) {
          handled = true
          break
        }
      }
      if (!handled) {
        lrc.lines.push({ time: -1, text: line, raw: line })
      }
    })
    // 构建完成后按时间轴升序排列
    lrc.lines.sort((a, b) => {
      if (a.time === -1 || b.time === -1) return 0
      return a.time - b.time
    })
    return lrc
  }
}

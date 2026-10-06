/**
 * 解读流末尾的建议问题标记（前端重设计 spec §8.2 的落地形态）。
 * /api/interpret 是纯文本流，附不了 JSON 字段，约定由模型在末尾输出
 * `【可以问我】问题1 | 问题2 | 问题3` 一行，这里负责拆出来。
 */
export const SUGGESTION_MARKER = '【可以问我】'

const MAX_SUGGESTIONS = 3

export interface ParsedInterpretation {
  /** 展示用正文：标记行已剥离；流式中连半截标记尾巴也藏住 */
  body: string
  /** 解析出的建议问题；只有流结束且标记行完整才有值 */
  suggestions: string[]
}

export function splitSuggestions(text: string, streaming: boolean): ParsedInterpretation {
  const at = text.indexOf(SUGGESTION_MARKER)
  if (at !== -1) {
    const body = text.slice(0, at).replace(/\s+$/, '')
    if (streaming) return { body, suggestions: [] }
    const suggestions = text.slice(at + SUGGESTION_MARKER.length)
      .split(/[|｜]/)
      .map(s => s.trim())
      .filter(s => s !== '')
      .slice(0, MAX_SUGGESTIONS)
    return { body, suggestions }
  }

  if (streaming) {
    // 标记是一个字一个字蹦出来的：尾巴恰好是标记前缀时先藏住，
    // 否则用户会看到「【可以问我」逐字闪现。不是前缀的正文不受影响
    for (let len = SUGGESTION_MARKER.length - 1; len > 0; len -= 1) {
      if (text.endsWith(SUGGESTION_MARKER.slice(0, len))) {
        return { body: text.slice(0, -len), suggestions: [] }
      }
    }
  }
  return { body: text, suggestions: [] }
}

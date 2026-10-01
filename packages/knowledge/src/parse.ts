import { marked } from 'marked'
import { parse as parseYaml } from 'yaml'

export interface Block {
  /** 块类型。未识别的类型原样保留，由前端降级渲染 */
  type: string
  /** 渲染后的 HTML */
  html: string
  /** 块的原始 Markdown */
  raw: string
}

const BLOCK_MARKER = /^<!--\s*@block\s+type="([^"]+)"\s*-->\s*$/gm

export function parseFrontmatter(raw: string): {
  data: Record<string, unknown>
  content: string
} {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw)
  if (!match) return { data: {}, content: raw }

  const parsed = parseYaml(match[1]!) as unknown
  const data =
    parsed !== null && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : {}

  return { data, content: raw.slice(match[0]!.length) }
}

export function parseBlocks(content: string): Block[] {
  const markers: Array<{ type: string; index: number; length: number }> = []

  for (const m of content.matchAll(BLOCK_MARKER)) {
    markers.push({ type: m[1]!, index: m.index!, length: m[0].length })
  }

  if (markers.length === 0) {
    const trimmed = content.trim()
    if (trimmed === '') return []
    return [{ type: 'free', html: render(trimmed), raw: trimmed }]
  }

  const blocks: Block[] = []

  const head = content.slice(0, markers[0]!.index).trim()
  if (head !== '') blocks.push({ type: 'free', html: render(head), raw: head })

  markers.forEach((marker, i) => {
    const start = marker.index + marker.length
    const end = i + 1 < markers.length ? markers[i + 1]!.index : content.length
    const raw = content.slice(start, end).trim()
    if (raw === '') return
    blocks.push({ type: marker.type, html: render(raw), raw })
  })

  return blocks
}

function render(markdown: string): string {
  return marked.parse(markdown, { async: false }) as string
}

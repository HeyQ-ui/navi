import { marked } from 'marked'
import { parse as parseYaml } from 'yaml'

export interface Block {
  /** 块类型。未识别的类型原样保留，由前端降级渲染 */
  type: string
  /** 容器写法 `:::myth 排名前 10% 就稳了` 里 `:::` 之后的那段。没有则为 undefined（§6.3 不强制字段） */
  title?: string
  /** 渲染后的 HTML */
  html: string
  /** 块的原始 Markdown */
  raw: string
}

const BLOCK_MARKER = /^<!--\s*@block\s+type="([^"]+)"\s*-->\s*$/gm

/** 容器起始行：`:::type` 或 `:::type 标题` */
const CONTAINER_START = /^:::([A-Za-z][\w-]*)[ \t]*(.*)$/
const CONTAINER_END = /^:::[ \t]*$/

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

/**
 * 剥掉正文里的容器标记，把容器标题提出来（设计文档 §6.3 第 4 条）。
 *
 * 逐行过滤而不是「配对剥壳」：未闭合、标题为空、正文没被容器包住，三种写法
 * 都能得到「raw 里永不含 :::」这一条不变量。写坏了的内容不该把标记漏给下游——
 * 模型读到 :::myth / :::cost 会把块类型当成可以招募给用户的话题。
 *
 * 块类型不从这里取：路径文档的类型来源是 @block 注解，容器只提供标题与正文。
 * 两处不一致时以 @block 为准，容器类型被忽略。
 */
function unwrapContainer(raw: string): { title?: string; body: string } {
  const lines = raw.split(/\r?\n/)
  const start = CONTAINER_START.exec(lines[0] ?? '')

  let title: string | undefined
  if (start) {
    const parsed = start[2]!.trim()
    if (parsed !== '') title = parsed
  }

  const body = lines
    .filter((line, i) => !(i === 0 && start !== null) && !CONTAINER_END.test(line))
    .join('\n')
    .trim()

  return title === undefined ? { body } : { title, body }
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
    const { title, body } = unwrapContainer(raw)
    const block: Block = { type: marker.type, html: render(body), raw: body }
    if (title !== undefined) block.title = title
    blocks.push(block)
  })

  return blocks
}

/**
 * 把 `:::type 标题` … `:::` 容器序列切成块（设计文档 §6.3 的 ::: 语法）。
 *
 * 与 parseBlocks 的分工：parseBlocks 认路径文档里的 `<!-- @block -->` 注解，
 * 本函数认 `:::` 容器。boundaries.md 整个文件就是容器序列、没有 @block 注解，
 * 走这条路才能每条边界各成一块，且 raw 里不留字面的 `:::` 标记。
 *
 * 容错：容器未闭合就遇到下一个起始行、或文件结束时仍未闭合，都按已收集的内容成块，
 * 不抛错——内容侧写坏了不该让构建挂掉（同 §6.4 的降级原则）。
 */
export function parseContainers(content: string): Block[] {
  const blocks: Block[] = []
  let open: { type: string; title: string; lines: string[] } | null = null

  const flush = () => {
    if (open === null) return
    blocks.push(toContainerBlock(open))
    open = null
  }

  for (const line of content.split(/\r?\n/)) {
    const start = CONTAINER_START.exec(line)
    if (start) {
      flush()
      open = { type: start[1]!, title: start[2]!.trim(), lines: [] }
      continue
    }
    if (CONTAINER_END.test(line)) {
      flush()
      continue
    }
    if (open) open.lines.push(line)
  }
  flush()

  return blocks
}

function toContainerBlock(c: { type: string; title: string; lines: string[] }): Block {
  const raw = c.lines.join('\n').trim()
  const block: Block = { type: c.type, html: render(raw), raw }
  if (c.title !== '') block.title = c.title
  return block
}

function render(markdown: string): string {
  return marked.parse(markdown, { async: false }) as string
}

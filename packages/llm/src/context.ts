import type { DiagnosisResult, KnowledgeBundle } from '@navi/core'
import type { ModelMessage } from 'ai'

export interface KnowledgeSlice {
  bundle: KnowledgeBundle
  result: DiagnosisResult
  /** 「本路径」——学生当前选中的那条 */
  pathId: string
}

/** 8 维分数 + 一致性，逐行列出 */
function formatIndicators(slice: KnowledgeSlice): string {
  // 键显式放宽为 string：indicators 的 id 是 IndicatorId 联合类型，
  // 而 Object.entries 给出的是 string
  const names = new Map<string, string>(slice.bundle.indicators.map(i => [i.id, i.name]))
  return Object.entries(slice.result.indicators)
    .map(([id, score]) => {
      if (!score.known) return `- ${names.get(id) ?? id}：无数据`
      return `- ${names.get(id) ?? id}：${Math.round(score.score)}/100（作答一致性 ${score.consistency.toFixed(2)}）`
    })
    .join('\n')
}

/** 路径匹配结果，含不适用原因 */
function formatPaths(slice: KnowledgeSlice): string {
  const titles = new Map(slice.bundle.paths.map(p => [p.id, p.title]))
  return slice.result.paths
    .map(p => {
      const title = titles.get(p.id) ?? p.id
      const reasons = p.eligibility.hardFailures.map(f => f.message).join('；')
      if (!p.eligibility.applicable) return `- ${title}：不适用（${reasons}）`
      return `- ${title}：匹配度 ${Math.round(p.match)}，置信度 ${Math.round(p.confidence * 100)}%`
    })
    .join('\n')
}

/** 画像软归属 */
function formatArchetypes(slice: KnowledgeSlice): string {
  const names = new Map(slice.bundle.archetypes.map(a => [a.id, a.name]))
  return slice.result.archetypes
    .slice(0, 3)
    .map(a => `- ${names.get(a.id) ?? a.id}：${Math.round(a.affinity * 100)}%`)
    .join('\n')
}

/** 本路径的完整正文（按知识库顺序，保留块标题） */
function formatCurrentPath(slice: KnowledgeSlice): string {
  const blocks = slice.bundle.blocks[slice.pathId] ?? []
  if (blocks.length === 0) return '（这条路径暂无正文内容）'
  return blocks.map(b => b.raw).join('\n\n')
}

/** 全部路径的 summary——回答「保研和考研怎么选」这类跨路径问题靠它 */
function formatAllSummaries(slice: KnowledgeSlice): string {
  return slice.bundle.paths
    .map(p => `### ${p.title}\n${p.summary}`)
    .join('\n\n')
}

function formatBoundaries(slice: KnowledgeSlice): string {
  if (slice.bundle.boundaries.length === 0) return '（无）'
  return slice.bundle.boundaries.map(b => b.raw).join('\n\n')
}

/**
 * 拼出 <knowledge> 块的内容（设计文档 §8.2 + §8.5）。
 * 顺序固定，便于测试与排查；模型只能使用这里面的信息（§8.3）。
 */
export function buildSystemContent(slice: KnowledgeSlice): string {
  const currentTitle =
    slice.bundle.paths.find(p => p.id === slice.pathId)?.title ?? slice.pathId

  return [
    '<knowledge>',
    '## 学生画像（8 个维度，0–100）',
    formatIndicators(slice),
    '',
    '## 诊断结果',
    formatPaths(slice),
    '',
    '## 画像标签',
    formatArchetypes(slice),
    '',
    `## 学生当前查看的路径：${currentTitle}（全文）`,
    formatCurrentPath(slice),
    '',
    '## 全部路径摘要',
    formatAllSummaries(slice),
    '',
    '## 我们无法可靠回答的问题',
    formatBoundaries(slice),
    '</knowledge>',
  ].join('\n')
}

export function buildInterpretMessages(input: {
  knowledge: KnowledgeSlice
  systemPrompt: string
}): ModelMessage[] {
  return [
    { role: 'system', content: `${input.systemPrompt}\n\n${buildSystemContent(input.knowledge)}` },
    { role: 'user', content: '请基于以上信息，输出我的个性化解读。' },
  ]
}

export function buildChatMessages(input: {
  knowledge: KnowledgeSlice
  systemPrompt: string
  history: ModelMessage[]
}): ModelMessage[] {
  return [
    { role: 'system', content: `${input.systemPrompt}\n\n${buildSystemContent(input.knowledge)}` },
    ...input.history,
  ]
}

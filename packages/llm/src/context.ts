import { findTiedPaths } from '@navi/core'
import type { Answers, Block, DiagnosisResult, KnowledgeBundle, Question } from '@navi/core'
import type { ModelMessage } from 'ai'

export interface HistoryAssessment {
  createdAt: string
  result: DiagnosisResult
}

export interface ChatTurnForContext {
  role: 'user' | 'assistant'
  content: string
}

export interface KnowledgeSlice {
  bundle: KnowledgeBundle
  result: DiagnosisResult
  /** 「本路径」——学生当前查看的那一条 */
  pathId: string
  /** 本次逐题作答（题目 id → 选项序号 0–4） */
  answers: Answers
  /** 历次自我测评摘要（**不含当次**），时间倒序。空或不传时整段不渲染（专项 §11.4） */
  history?: HistoryAssessment[]
  /** 已按来源过滤的对话轮次，时间正序。空或不传时整段不渲染（专项 §11.4） */
  conversation?: ChatTurnForContext[]
}

/** 选项序号到可见记号。§5.2 的五档：档位越高，该指标越高 */
const OPTION_MARKS = ['①', '②', '③', '④', '⑤']

/** 8 维分数。不带作答一致性——它是内部指标，不进模型上下文（设计文档 §7.3） */
function formatIndicators(slice: KnowledgeSlice): string {
  const names = new Map<string, string>(slice.bundle.indicators.map(i => [i.id, i.name]))
  return Object.entries(slice.result.indicators)
    .map(([id, score]) => {
      if (!score.known) return `- ${names.get(id) ?? id}：无数据`
      return `- ${names.get(id) ?? id}：${Math.round(score.score)}/100`
    })
    .join('\n')
}

/** 路径匹配结果，含不适用原因。不带置信度（设计文档 §7.4） */
function formatPaths(slice: KnowledgeSlice): string {
  const titles = new Map(slice.bundle.paths.map(p => [p.id, p.title]))
  return slice.result.paths
    .map(p => {
      const title = titles.get(p.id) ?? p.id
      const reasons = p.eligibility.hardFailures.map(f => f.message).join('；')
      if (!p.eligibility.applicable) return `- ${title}：不适用（${reasons}）`
      return `- ${title}：匹配度 ${Math.round(p.match)}`
    })
    .join('\n')
}

/**
 * 本路径的分项贡献（设计文档 §8.2）。
 *
 * 只给「哪些因素在起作用、你在这几项上的位置」，不给公式——因此**不渲染权重与
 * 乘积**。权重是算法的系数，把它写进上下文等于把公式的原料递到模型嘴边：实测
 * 模型会逐字复述「每项先看你当前位置离理想值有多远，再乘上它的权重」，而 §8.2
 * 要的是构成要素。「哪项更关键」这层信息由排序承载，不需要数字。
 *
 * 理想值保留：它描述的是这条路径偏好的位置，属 §9.4「画像对比」本就要展示给
 * 用户的数据，不是公式系数。
 */
function formatContributions(slice: KnowledgeSlice): string {
  const current = slice.result.paths.find(p => p.id === slice.pathId)
  if (current === undefined) return '（没有这条路径的诊断结果）'
  if (current.contributions.length === 0) {
    // 分项为空有两种成因，文案要对得上：没有定义权重，和硬性不适用。
    // 一律说成「不适用」会在前一种情形下给用户一句事实错误的话。
    return current.eligibility.applicable
      ? '（这条路径没有定义权重，因此没有分项依据）'
      : '（这条路径当前对你硬性不适用，没有分项依据）'
  }

  const names = new Map<string, string>(slice.bundle.indicators.map(i => [i.id, i.name]))
  const pathDef = slice.bundle.paths.find(p => p.id === slice.pathId)
  const ideals = new Map<string, number>((pathDef?.weights ?? []).map(w => [w.indicator, w.ideal]))

  const lines = [...current.contributions]
    .sort((a, b) => b.contribution - a.contribution)
    .map(c => {
      const mine = slice.result.indicators[c.indicator]
      const where = mine?.known ? `你的位置 ${Math.round(mine.score)}` : '你的位置无数据'
      const ideal = ideals.get(c.indicator)
      const idealText = ideal === undefined ? '' : `，这条路径偏好的位置是 ${ideal}`
      return `- ${names.get(c.indicator) ?? c.indicator}：${where}${idealText}`
    })

  return ['（按影响从大到小排列：越靠前，这个维度对这条路径的判断越关键）', ...lines].join('\n')
}

/** 画像软归属 */
function formatArchetypes(slice: KnowledgeSlice): string {
  const names = new Map(slice.bundle.archetypes.map(a => [a.id, a.name]))
  return slice.result.archetypes
    .slice(0, 3)
    .map(a => `- ${names.get(a.id) ?? a.id}：${Math.round(a.affinity * 100)}%`)
    .join('\n')
}

/** 单道题的题干与学生的选择。答案缺失或越界时显示「未作答」，不让异常数据打断装配 */
function formatQuestion(question: Question, answer: number | undefined): string {
  const head = `- ${question.text}`
  const valid =
    answer !== undefined && Number.isInteger(answer) && answer >= 0 && answer < question.options.length
  if (!valid) return `${head}\n  你的选择：未作答`
  return `${head}\n  你的选择：${OPTION_MARKS[answer] ?? answer} ${question.options[answer] ?? ''}`
}

/**
 * 本次问卷的题干、选项与学生的逐题作答（设计文档 §8.2）。
 *
 * 没有这一段，模型无法回答「为什么是这条路径」——它只有分数与匹配度，任何
 * 「为什么」都只能是反推，而反推就是编造。
 *
 * 按 bundle.questions 迭代而不是遍历 answers 的键：answers 允许夹带其他年级的
 * 题目 id（§5.5 的刻意容忍），按键遍历会把那些题目一并喂给模型。
 */
function formatQuestions(slice: KnowledgeSlice): string {
  if (slice.bundle.questions.length === 0) return '（本次没有题目记录）'
  return slice.bundle.questions.map(q => formatQuestion(q, slice.answers[q.id])).join('\n')
}

/**
 * 块的渲染：保留块标题——标题是内容（如「排名前 10% 就稳了」「目标真空、盲目跟风」），
 * 被剥掉的只有 ::: 标记与块类型（设计文档 §6.3 第 4 条）。
 */
function formatBlocks(blocks: Block[]): string {
  return blocks
    .map(b => (b.title === undefined ? b.raw : `**${b.title}**\n${b.raw}`))
    .join('\n\n')
}

/** 本路径的完整正文（按知识库顺序） */
function formatCurrentPath(slice: KnowledgeSlice): string {
  const blocks = slice.bundle.blocks[slice.pathId] ?? []
  if (blocks.length === 0) return '（这条路径暂无正文内容）'
  return formatBlocks(blocks)
}

/**
 * 跨路径通用知识（设计文档 §8.5 v1.5）：新生误区与多路径对比。
 *
 * 返回 null 而非「（无）」是刻意的：空的时候整段不出现，与历次自我测评、此前的
 * 对话同款，而不是留一个空标题。这些差异也**只有**这里给得出——让模型从摘要现场
 * 归纳，归纳出的差异不受 §8.3 的可追溯约束。
 */
function formatCommon(slice: KnowledgeSlice): string | null {
  if (slice.bundle.common.length === 0) return null
  return formatBlocks(slice.bundle.common)
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
 * 历次自我测评摘要（专项 §11.4）。
 *
 * **不含当次**——当次的完整结果已在上面的「诊断结果」段里，列进来就是重复。
 * 标题里明说「不含本次」，是因为模型看到一串历史时很容易把最近那条当成当次，
 * 那会让「你的变化」段算错一次。
 */
function formatHistory(slice: KnowledgeSlice): string | null {
  const history = slice.history ?? []
  if (history.length === 0) return null

  // 显式给出 Map 的类型参数：IndicatorId / PathId 是字面量联合，而 Object.entries
  // 出来的是 string，不收窄就会在 .get() 上报 TS2345（同 formatIndicators 的写法）
  const titles = new Map<string, string>(slice.bundle.paths.map(p => [p.id, p.title]))
  const names = new Map<string, string>(slice.bundle.indicators.map(i => [i.id, i.name]))

  return history.map(entry => {
    const main = findTiedPaths(entry.result)[0]
    const date = entry.createdAt.slice(0, 10)
    const scores = Object.entries(entry.result.indicators)
      .map(([id, s]) => {
        const name = names.get(id) ?? id
        return `${name}：${s.known ? `${Math.round(s.score)}/100` : '无数据'}`
      })
      .join('，')
    const path = main === undefined
      ? '当前没有匹配的路径'
      : `主推荐路径：${titles.get(main.id) ?? main.id}（匹配度 ${Math.round(main.match)}）`
    return `- ${date} ${path}\n  ${scores}`
  }).join('\n')
}

/** 此前的对话（专项 §11.4）。只渲染内容与角色，不渲染时间——时间对判断没有帮助 */
function formatConversation(slice: KnowledgeSlice): string | null {
  const conversation = slice.conversation ?? []
  if (conversation.length === 0) return null
  return conversation
    .map(turn => `${turn.role === 'user' ? '学生' : '你'}：${turn.content}`)
    .join('\n\n')
}

/**
 * 拼出 <knowledge> 块的内容（设计文档 §8.2 + §8.5、专项 §11.4）。
 * 顺序固定，便于测试与排查；模型只能使用这里面的信息（§8.3）。
 */
export function buildSystemContent(slice: KnowledgeSlice): string {
  const currentTitle =
    slice.bundle.paths.find(p => p.id === slice.pathId)?.title ?? slice.pathId

  // 两段都是条件插入：没有内容时整段不出现，而不是留一个空标题
  const historyBlock = formatHistory(slice)
  const conversationBlock = formatConversation(slice)
  const commonBlock = formatCommon(slice)

  return [
    '<knowledge>',
    // 维度数按实际渲染的条数生成。写死的常数已经过期过一次：v1.4 删掉
    // gpa-competitiveness 后指标由 11 项降为 10 项，标题里的「8 个」留了下来，
    // 与 §8.5 的「10 维分数」、§9.4 的「7 维雷达图（画像指标）」三方对不上
    `## 学生画像（${Object.keys(slice.result.indicators).length} 个维度，0–100）`,
    formatIndicators(slice),
    '',
    '## 诊断结果',
    formatPaths(slice),
    '',
    `### 本路径（${currentTitle}）的匹配依据`,
    formatContributions(slice),
    ...(historyBlock === null
      ? []
      : ['', '## 历次自我测评（最近数次，不含本次）', historyBlock]),
    '',
    '## 画像标签',
    formatArchetypes(slice),
    '',
    '## 本次问卷与学生的逐题作答（选项序号 ①–⑤ 依次由低到高）',
    formatQuestions(slice),
    '',
    `## 学生当前查看的路径：${currentTitle}（全文）`,
    formatCurrentPath(slice),
    '',
    '## 全部路径摘要',
    formatAllSummaries(slice),
    ...(commonBlock === null
      ? []
      : ['', '## 通用知识（跨路径共用）', commonBlock]),
    // 对话放在最后：信息的新近性决定了它该离提问最近
    ...(conversationBlock === null
      ? []
      : ['', '## 此前的对话（最近数轮）', conversationBlock]),
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

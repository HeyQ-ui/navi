import type { Answers, IndicatorDef, IndicatorScore, Question } from './types.js'

/** 五档评分映射（设计文档 §5.2）。题目没有 scores 时按选项位置取这一档 */
export const FIVE_POINT_SCALE = [0, 25, 50, 75, 100] as const

/**
 * 作答一致性：同一指标下各题得分的离散程度（设计文档 §7.3）。
 * stdev 理论最大值为 50（一半 0 分、一半 100 分），此时一致性为 0。
 * 单题指标（样本不足）恒为 0。
 */
export function consistencyOf(scores: number[]): number {
  if (scores.length < 2) return 0
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length
  const variance = scores.reduce((s, x) => s + (x - mean) ** 2, 0) / scores.length
  const stdev = Math.sqrt(variance)
  return Math.max(0, 1 - stdev / 50)
}

/** 该题是否参与某指标计分：weight>0，且题面确实携带这个指标 */
function measures(question: Question, indicatorId: string): boolean {
  if (question.weight <= 0) return false
  if (question.scores !== undefined) {
    return question.scores.some(optionScores => optionScores[indicatorId] !== undefined)
  }
  return question.indicator === indicatorId
}

/**
 * 某选项对该指标的分值。返回 undefined 表示「无信息」，该题不参与这个指标的计算：
 * 未作答、选项越界，或该选项没有写这个指标（设计文档 §5.2 的意愿题就靠这个表达
 * 「还没想好」——它不能算成 0 分，那会变成学生没表达过的负向判断）。
 */
function valueFor(
  question: Question,
  indicatorId: string,
  answer: number | undefined,
): number | undefined {
  if (answer === undefined || !Number.isInteger(answer)) return undefined
  // 上界用 options.length 而不是五档表长度：4 选项题的下标 3 是合法作答
  if (answer < 0 || answer >= question.options.length) return undefined

  if (question.scores !== undefined) return question.scores[answer]?.[indicatorId]
  if (answer >= FIVE_POINT_SCALE.length) return undefined
  return FIVE_POINT_SCALE[answer]
}

export function computeIndicatorScores(
  answers: Answers,
  questions: Question[],
  indicators: IndicatorDef[],
): Record<string, IndicatorScore> {
  const result: Record<string, IndicatorScore> = {}

  for (const indicator of indicators) {
    // weight <= 0 的题目（如资格判断题）不参与指标计分，也不参与一致性计算
    const applicable = questions.filter(q => measures(q, indicator.id))
    const answered = applicable.flatMap(question => {
      const value = valueFor(question, indicator.id, answers[question.id])
      return value === undefined ? [] : [{ question, value }]
    })

    if (answered.length === 0) {
      result[indicator.id] = { score: 0, known: false, consistency: 0, sources: [] }
      continue
    }

    const totalWeight = answered.reduce((s, a) => s + a.question.weight, 0)
    const scores = answered.map(a => a.value)
    const score = answered.reduce((s, a) => s + a.value * a.question.weight, 0) / totalWeight

    result[indicator.id] = {
      score,
      known: true,
      consistency: consistencyOf(scores),
      sources: answered.map(a => a.question.id),
    }
  }

  return result
}

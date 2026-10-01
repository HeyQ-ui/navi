import type { Answers, IndicatorDef, IndicatorScore, Question } from './types.js'

/** 五档评分映射（设计文档 §5.2） */
export const FIVE_POINT_SCALE = [0, 25, 50, 75, 100] as const

/**
 * 作答一致性：同一指标下各题得分的离散程度（设计文档 §7.3）。
 * stdev 理论最大值为 50（一半 0 分、一半 100 分），此时一致性为 0。
 */
export function consistencyOf(scores: number[]): number {
  if (scores.length < 2) return 0
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length
  const variance = scores.reduce((s, x) => s + (x - mean) ** 2, 0) / scores.length
  const stdev = Math.sqrt(variance)
  return Math.max(0, 1 - stdev / 50)
}

export function computeIndicatorScores(
  answers: Answers,
  questions: Question[],
  indicators: IndicatorDef[],
): Record<string, IndicatorScore> {
  const result: Record<string, IndicatorScore> = {}

  for (const indicator of indicators) {
    // weight <= 0 的题目（如资格判断题）不参与指标计分，也不参与一致性计算
    const applicable = questions.filter(q => q.indicator === indicator.id && q.weight > 0)
    const answered = applicable.filter(q => {
      const idx = answers[q.id]
      return idx !== undefined && Number.isInteger(idx) && idx >= 0 && idx < FIVE_POINT_SCALE.length
    })

    if (answered.length === 0) {
      result[indicator.id] = { score: 0, known: false, consistency: 0, sources: [] }
      continue
    }

    const totalWeight = answered.reduce((s, q) => s + q.weight, 0)
    const scores = answered.map(q => FIVE_POINT_SCALE[answers[q.id]!]!)
    const score = answered.reduce((s, q, i) => s + scores[i]! * q.weight, 0) / totalWeight

    result[indicator.id] = {
      score,
      known: true,
      consistency: consistencyOf(scores),
      sources: answered.map(q => q.id),
    }
  }

  return result
}

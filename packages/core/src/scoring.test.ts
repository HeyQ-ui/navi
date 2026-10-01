import { describe, it, expect } from 'vitest'
import { computeIndicatorScores } from './scoring.js'
import type { Question, IndicatorDef } from './types.js'

const indicators: IndicatorDef[] = [
  { id: 'academic-interest', name: '学术志趣' },
  { id: 'risk-preference', name: '风险偏好' },
]

function q(id: string, indicator: string, weight = 1): Question {
  return { id, indicator: indicator as never, text: id, options: ['a','b','c','d','e'], weight }
}

const questions: Question[] = [
  q('q1', 'academic-interest'),
  q('q2', 'academic-interest'),
  q('q3', 'academic-interest'),
]

describe('computeIndicatorScores', () => {
  it('五档选项映射为 0/25/50/75/100', () => {
    const scores = computeIndicatorScores({ q1: 0, q2: 4, q3: 2 }, questions, indicators)
    expect(scores['academic-interest']!.score).toBe(50)
    expect(scores['academic-interest']!.known).toBe(true)
  })

  it('全部选中间档得到 50 分', () => {
    const scores = computeIndicatorScores({ q1: 2, q2: 2, q3: 2 }, questions, indicators)
    expect(scores['academic-interest']!.score).toBe(50)
  })

  it('按题目权重加权平均', () => {
    const weighted: Question[] = [
      q('q1', 'academic-interest', 3),
      q('q2', 'academic-interest', 1),
    ]
    const scores = computeIndicatorScores({ q1: 4, q2: 0 }, weighted, indicators)
    expect(scores['academic-interest']!.score).toBe(75)
  })

  it('记录参与计算的题目来源', () => {
    const scores = computeIndicatorScores({ q1: 1, q2: 1, q3: 1 }, questions, indicators)
    expect(scores['academic-interest']!.sources.sort()).toEqual(['q1', 'q2', 'q3'])
  })

  it('没有任何答案时标记为 known: false 且不产生 NaN', () => {
    const scores = computeIndicatorScores({}, questions, indicators)
    expect(scores['academic-interest']!.known).toBe(false)
    expect(Number.isNaN(scores['academic-interest']!.score)).toBe(false)
    expect(scores['academic-interest']!.score).toBe(0)
  })

  it('完全没有题目的指标同样标记为 known: false', () => {
    const scores = computeIndicatorScores({ q1: 1 }, questions, indicators)
    expect(scores['risk-preference']!.known).toBe(false)
  })

  it('超出范围的选项索引被忽略而不是算成 NaN', () => {
    const scores = computeIndicatorScores({ q1: 99, q2: 2, q3: 2 }, questions, indicators)
    expect(Number.isNaN(scores['academic-interest']!.score)).toBe(false)
    expect(scores['academic-interest']!.score).toBe(50)
  })

  it('weight 为 0 的资格题不参与计分，也不影响一致性', () => {
    const withEligibility: Question[] = [...questions, q('elig', 'academic-interest', 0)]
    const scores = computeIndicatorScores(
      { q1: 2, q2: 2, q3: 2, elig: 4 },
      withEligibility,
      indicators,
    )
    expect(scores['academic-interest']!.score).toBe(50)
    expect(scores['academic-interest']!.consistency).toBe(1)
    expect(scores['academic-interest']!.sources).not.toContain('elig')
  })
})

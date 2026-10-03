import { describe, it, expect } from 'vitest'
import { computeIndicatorScores, consistencyOf } from './scoring.js'
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

describe('一题多指标（scores 字段）', () => {
  const intentionIndicators: IndicatorDef[] = [
    { id: 'grad-intention-baoyan', name: '保研意愿' },
    { id: 'grad-intention-kaoyan', name: '考研意愿' },
  ]

  const intention: Question = {
    id: 'grad-intention-1',
    text: '毕业后的去向？',
    options: ['保研', '考研', '不读研', '还没想好'],
    weight: 1,
    scores: [
      { 'grad-intention-baoyan': 100, 'grad-intention-kaoyan': 0 },
      { 'grad-intention-baoyan': 0, 'grad-intention-kaoyan': 100 },
      { 'grad-intention-baoyan': 0, 'grad-intention-kaoyan': 0 },
      {},
    ],
  }

  it('按选项给出各指标的分值', () => {
    const s = computeIndicatorScores({ 'grad-intention-1': 1 }, [intention], intentionIndicators)
    expect(s['grad-intention-baoyan']!.score).toBe(0)
    expect(s['grad-intention-kaoyan']!.score).toBe(100)
    expect(s['grad-intention-kaoyan']!.sources).toEqual(['grad-intention-1'])
  })

  it('「不读研」两条路径都得 0 分', () => {
    const s = computeIndicatorScores({ 'grad-intention-1': 2 }, [intention], intentionIndicators)
    expect(s['grad-intention-baoyan']!.score).toBe(0)
    expect(s['grad-intention-baoyan']!.known).toBe(true)
    expect(s['grad-intention-kaoyan']!.score).toBe(0)
    expect(s['grad-intention-kaoyan']!.known).toBe(true)
  })

  it('「还没想好」不产生分值，指标未已知', () => {
    const s = computeIndicatorScores({ 'grad-intention-1': 3 }, [intention], intentionIndicators)
    expect(s['grad-intention-baoyan']!.known).toBe(false)
    expect(s['grad-intention-kaoyan']!.known).toBe(false)
  })

  it('越界选项视为未作答', () => {
    const s = computeIndicatorScores({ 'grad-intention-1': 9 }, [intention], intentionIndicators)
    expect(s['grad-intention-baoyan']!.known).toBe(false)
  })

  it('4 选项题不会拿五档表去索引', () => {
    const four: Question = {
      id: 'four-1',
      text: '？',
      options: ['a', 'b', 'c', 'd'],
      weight: 1,
      scores: [{}, {}, {}, {}],
    }
    const s = computeIndicatorScores({ 'four-1': 3 }, [four], intentionIndicators)
    expect(s['grad-intention-baoyan']!.known).toBe(false)
  })
})

describe('consistencyOf 边界', () => {
  it('全部同分时一致性为 1', () => {
    expect(consistencyOf([50, 50, 50])).toBe(1)
  })

  it('极端分化（一半 0 一半 100）时一致性为 0', () => {
    expect(consistencyOf([0, 100])).toBe(0)
  })

  it('结果永远不为负', () => {
    for (const set of [[0, 100, 0, 100], [0, 0, 100], [100, 0, 0, 100, 0]]) {
      expect(consistencyOf(set)).toBeGreaterThanOrEqual(0)
    }
  })

  it('题目少于 2 道时返回 0（无法判断一致性）', () => {
    expect(consistencyOf([80])).toBe(0)
    expect(consistencyOf([])).toBe(0)
  })

  it('轻微分歧时一致性介于 0 与 1 之间', () => {
    const c = consistencyOf([50, 75, 50])
    expect(c).toBeGreaterThan(0)
    expect(c).toBeLessThan(1)
  })
})

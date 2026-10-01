import { describe, it, expect } from 'vitest'
import { computePathMatch, indicatorMatch } from './matching.js'
import type { IndicatorScore, PathWeight } from './types.js'

function s(score: number, consistency = 1): IndicatorScore {
  return { score, known: true, consistency, sources: [] }
}

const weights: PathWeight[] = [
  { indicator: 'academic-interest', weight: 0.5, ideal: 100 },
  { indicator: 'gpa-competitiveness', weight: 0.5, ideal: 100 },
]

describe('indicatorMatch', () => {
  it('命中理想值时为 100', () => {
    expect(indicatorMatch(85, 85)).toBe(100)
  })

  it('按差值线性衰减', () => {
    expect(indicatorMatch(55, 90)).toBe(65)
    expect(indicatorMatch(95, 90)).toBe(95)
  })

  it('差值达到 100 时为 0，不为负', () => {
    expect(indicatorMatch(0, 100)).toBe(0)
    expect(indicatorMatch(100, 0)).toBe(0)
  })
})

describe('computePathMatch', () => {
  it('全部命中理想值时匹配度为 100', () => {
    const r = computePathMatch(
      { 'academic-interest': s(100), 'gpa-competitiveness': s(100) },
      weights,
    )
    expect(r.match).toBeCloseTo(100, 10)
  })

  it('按权重汇总各项贡献之和等于总分', () => {
    const r = computePathMatch(
      { 'academic-interest': s(80), 'gpa-competitiveness': s(60) },
      weights,
    )
    const sum = r.contributions.reduce((acc, c) => acc + c.contribution, 0)
    expect(r.match).toBeCloseTo(sum, 10)
    expect(r.contributions).toHaveLength(2)
  })

  it('置信度是一致性按权重的加权平均', () => {
    const r = computePathMatch(
      { 'academic-interest': s(80, 1.0), 'gpa-competitiveness': s(60, 0.5) },
      weights,
    )
    expect(r.confidence).toBeCloseTo(0.75, 10)
  })

  it('存在未知指标时权重重新归一化，匹配度仍在 0–100', () => {
    const r = computePathMatch(
      {
        'academic-interest': s(80),
        'gpa-competitiveness': { score: 0, known: false, consistency: 0, sources: [] },
      },
      weights,
    )
    expect(r.match).toBeCloseTo(80, 10)
    expect(r.contributions).toHaveLength(1)
  })

  it('全部指标未知时匹配度为 0、置信度为 0，不产生 NaN', () => {
    const r = computePathMatch(
      {
        'academic-interest': { score: 0, known: false, consistency: 0, sources: [] },
        'gpa-competitiveness': { score: 0, known: false, consistency: 0, sources: [] },
      },
      weights,
    )
    expect(r.match).toBe(0)
    expect(r.confidence).toBe(0)
    expect(r.contributions).toEqual([])
  })

  it('每个 contribution 的 weight 都是重归一化后的值，总和为 1', () => {
    const r = computePathMatch(
      { 'academic-interest': s(80), 'gpa-competitiveness': s(60) },
      weights,
    )
    const total = r.contributions.reduce((acc, c) => acc + c.weight, 0)
    expect(total).toBeCloseTo(1, 10)
  })
})

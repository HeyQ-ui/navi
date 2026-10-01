import { describe, it, expect } from 'vitest'
import { normalizeWeights } from './weights.js'
import type { IndicatorScore, PathWeight } from './types.js'

function known(score = 50): IndicatorScore {
  return { score, known: true, consistency: 1, sources: [] }
}
function unknown(): IndicatorScore {
  return { score: 0, known: false, consistency: 0, sources: [] }
}

const weights: PathWeight[] = [
  { indicator: 'academic-interest', weight: 0.25, ideal: 85 },
  { indicator: 'gpa-competitiveness', weight: 0.35, ideal: 90 },
  { indicator: 'risk-preference', weight: 0.40, ideal: 75 },
]

describe('normalizeWeights', () => {
  it('全部已知时权重保持不变，coverage 为 1', () => {
    const { entries, coverage } = normalizeWeights(weights, {
      'academic-interest': known(),
      'gpa-competitiveness': known(),
      'risk-preference': known(),
    })
    expect(coverage).toBe(1)
    expect(entries.map(e => e.weight)).toEqual([0.25, 0.35, 0.40])
  })

  it('部分未知时剩余权重按比例放大且总和为 1', () => {
    const { entries, coverage } = normalizeWeights(weights, {
      'academic-interest': known(),
      'gpa-competitiveness': known(),
      'risk-preference': unknown(),
    })
    expect(coverage).toBeCloseTo(0.6, 10)
    const total = entries.reduce((s, e) => s + e.weight, 0)
    expect(total).toBeCloseTo(1, 10)
    expect(entries.find(e => e.indicator === 'academic-interest')!.weight).toBeCloseTo(0.25 / 0.6, 10)
  })

  it('未知指标被排除在结果之外', () => {
    const { entries } = normalizeWeights(weights, {
      'academic-interest': known(),
      'gpa-competitiveness': unknown(),
      'risk-preference': unknown(),
    })
    expect(entries).toHaveLength(1)
    expect(entries[0]!.indicator).toBe('academic-interest')
  })

  it('全部未知时返回空数组且 coverage 为 0，不产生 NaN', () => {
    const { entries, coverage } = normalizeWeights(weights, {
      'academic-interest': unknown(),
      'gpa-competitiveness': unknown(),
      'risk-preference': unknown(),
    })
    expect(entries).toEqual([])
    expect(coverage).toBe(0)
  })

  it('权重缺失的指标按未知处理', () => {
    const { entries, coverage } = normalizeWeights(weights, {
      'academic-interest': known(),
    })
    expect(entries).toHaveLength(1)
    expect(coverage).toBeCloseTo(0.25, 10)
  })
})

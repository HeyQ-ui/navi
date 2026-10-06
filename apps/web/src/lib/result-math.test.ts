import { describe, it, expect } from 'vitest'
import { radarRows, gapRows, mainPathOf, PROFILE_INDICATORS } from './result-math.js'
import type { DiagnosisResult } from '@navi/core'

const indicators = [
  { id: 'academic-interest', name: '学术志趣' },
  { id: 'accumulation-drive', name: '积累行动力' },
  { id: 'grad-intention-baoyan', name: '保研意愿' },
]

function score(score: number) {
  return { score, known: true, consistency: 1, sources: [] }
}

const result: DiagnosisResult = {
  indicators: {
    'academic-interest': score(80),
    'accumulation-drive': score(60),
    'grad-intention-baoyan': score(90),
  },
  paths: [],
  archetypes: [],
}

describe('radarRows', () => {
  it('只取 7 个画像类指标，意愿类不入图（主文档 §9.2）', () => {
    const rows = radarRows(result, indicators)
    expect(rows.map(r => r.id)).toEqual(['academic-interest', 'accumulation-drive'])
    expect(PROFILE_INDICATORS).not.toContain('grad-intention-baoyan')
    expect(rows[0]).toMatchObject({ name: '学术志趣', score: 80 })
  })

  it('未知（known=false）的指标不入图', () => {
    const r = { ...result, indicators: { ...result.indicators, 'academic-interest': { ...score(80), known: false } } }
    expect(radarRows(r, indicators)).toHaveLength(1)
  })

  it('给理想值时带上 ideal 字段', () => {
    const rows = radarRows(result, indicators, id => (id === 'academic-interest' ? 95 : undefined))
    expect(rows[0]!.ideal).toBe(95)
    expect(rows[1]!.ideal).toBeUndefined()
  })
})

describe('gapRows', () => {
  const weights = [
    { indicator: 'academic-interest' as const, weight: 1, ideal: 95 },
    { indicator: 'accumulation-drive' as const, weight: 1, ideal: 90 },
    { indicator: 'grad-intention-baoyan' as const, weight: 1, ideal: 92 },
  ]

  it('按差距降序取前 3，带上你/理想两个值', () => {
    const rows = gapRows(result, indicators, weights)
    expect(rows).toHaveLength(3)
    expect(rows[0]).toMatchObject({ id: 'accumulation-drive', score: 60, ideal: 90, gap: 30 })
    expect(rows[1]).toMatchObject({ id: 'academic-interest', gap: 15 })
    expect(rows[2]).toMatchObject({ id: 'grad-intention-baoyan', gap: 2 })
  })
})

describe('mainPathOf', () => {
  const applicable = {
    id: 'a', match: 70, confidence: 1, contributions: [],
    eligibility: { applicable: true, hardFailures: [], softWarnings: [] },
  }
  const blocked = {
    id: 'b', match: 99, confidence: 1, contributions: [],
    eligibility: { applicable: false, hardFailures: [{ id: 'x', severity: 'hard' as const, message: 'm' }], softWarnings: [] },
  }

  it('主推荐是第一条可适用路径，分再高的不适用路径也不算', () => {
    expect(mainPathOf({ ...result, paths: [blocked, applicable] })!.id).toBe('a')
  })

  it('全部不适用时返回 null', () => {
    expect(mainPathOf({ ...result, paths: [blocked] })).toBeNull()
  })
})

import { describe, it, expect } from 'vitest'
import { cosineSimilarity, computeArchetypeAffinity } from './archetype.js'
import type { ArchetypeDef, IndicatorScore } from './types.js'

function s(score: number): IndicatorScore {
  return { score, known: true, consistency: 1, sources: [] }
}

const archetypes: ArchetypeDef[] = [
  {
    id: 'steady-scholar', name: '稳健学术型',
    vector: { 'academic-interest': 100, 'accumulation-drive': 50 },
    narrative: { oneLiner: '', strengths: [], blindspots: [] },
  },
  {
    id: 'pragmatic-builder', name: '务实行动型',
    vector: { 'academic-interest': 50, 'accumulation-drive': 100 },
    narrative: { oneLiner: '', strengths: [], blindspots: [] },
  },
]

describe('cosineSimilarity', () => {
  it('同向向量相似度为 1', () => {
    expect(cosineSimilarity([1, 1], [2, 2])).toBeCloseTo(1, 10)
  })

  it('正交向量相似度为 0', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 10)
  })

  it('任一侧为零向量时返回 0 而不是 NaN', () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0)
    expect(cosineSimilarity([], [])).toBe(0)
  })

  it('长度不一致时按较短长度计算，不抛错', () => {
    expect(() => cosineSimilarity([1, 1, 1], [1, 1])).not.toThrow()
  })
})

describe('computeArchetypeAffinity', () => {
  it('输出所有原型的归属度，且总和约为 1', () => {
    const result = computeArchetypeAffinity(
      { 'academic-interest': s(90), 'accumulation-drive': s(50) },
      archetypes,
    )
    expect(result).toHaveLength(2)
    const total = result.reduce((acc, r) => acc + r.affinity, 0)
    expect(total).toBeCloseTo(1, 6)
  })

  it('按归属度降序排列', () => {
    const result = computeArchetypeAffinity(
      { 'academic-interest': s(90), 'accumulation-drive': s(50) },
      archetypes,
    )
    expect(result[0]!.id).toBe('steady-scholar')
    expect(result[0]!.affinity).toBeGreaterThan(result[1]!.affinity)
  })

  it('学生不属于任何原型时仍返回全部原型，不返回空数组', () => {
    const result = computeArchetypeAffinity({}, archetypes)
    expect(result).toHaveLength(2)
    expect(result.every(r => Number.isFinite(r.affinity))).toBe(true)
  })

  it('所有指标未知时归属度均分，不产生 NaN', () => {
    const result = computeArchetypeAffinity({}, archetypes)
    expect(result.every(r => Number.isNaN(r.affinity))).toBe(false)
    expect(result[0]!.affinity).toBeCloseTo(0.5, 6)
  })

  it('原型列表为空时返回空数组', () => {
    expect(computeArchetypeAffinity({ 'academic-interest': s(50) }, [])).toEqual([])
  })

  it('温度参数越小分布越尖锐', () => {
    const scores = { 'academic-interest': s(90), 'accumulation-drive': s(50) }
    const sharp = computeArchetypeAffinity(scores, archetypes, 0.02)
    const flat = computeArchetypeAffinity(scores, archetypes, 0.5)
    expect(sharp[0]!.affinity).toBeGreaterThan(flat[0]!.affinity)
  })
})

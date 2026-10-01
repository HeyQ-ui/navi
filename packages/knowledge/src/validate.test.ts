import { describe, it, expect } from 'vitest'
import { validateKnowledge } from './validate.js'
import type { KnowledgeBundle } from './validate.js'

function bundle(overrides: Partial<KnowledgeBundle> = {}): KnowledgeBundle {
  return {
    indicators: [{ id: 'academic-interest', name: '学术志趣' }],
    questions: [
      { id: 'q1', indicator: 'academic-interest', text: 'q1', options: ['a','b','c','d','e'], weight: 1 },
      { id: 'q2', indicator: 'academic-interest', text: 'q2', options: ['a','b','c','d','e'], weight: 1 },
      { id: 'q3', indicator: 'academic-interest', text: 'q3', options: ['a','b','c','d','e'], weight: 1 },
    ],
    archetypes: [],
    paths: [{
      id: 'same-discipline-baoyan',
      title: '本学科保研',
      category: 'academic',
      span: 'same-discipline',
      status: 'verified',
      weights: [{ indicator: 'academic-interest', weight: 1, ideal: 85 }],
      eligibility: [],
      summary: '摘要',
    }],
    blocks: { 'same-discipline-baoyan': [] },
    ...overrides,
  }
}

describe('validateKnowledge', () => {
  it('合法的知识库没有警告', () => {
    expect(validateKnowledge(bundle())).toEqual([])
  })

  it('指标题目少于 3 道时给出警告', () => {
    const b = bundle()
    b.questions = b.questions.slice(0, 2)
    const warnings = validateKnowledge(b)
    expect(warnings.some(w => w.includes('academic-interest') && w.includes('3'))).toBe(true)
  })

  it('题目引用了不存在的指标时给出警告', () => {
    const b = bundle()
    b.questions[0]!.indicator = 'not-exist'
    const warnings = validateKnowledge(b)
    expect(warnings.some(w => w.includes('not-exist'))).toBe(true)
  })

  it('路径权重引用了不存在的指标时给出警告', () => {
    const b = bundle()
    b.paths[0]!.weights[0]!.indicator = 'not-exist'
    const warnings = validateKnowledge(b)
    expect(warnings.some(w => w.includes('not-exist'))).toBe(true)
  })

  it('路径 id 重复时给出警告', () => {
    const b = bundle()
    b.paths.push({ ...b.paths[0]! })
    const warnings = validateKnowledge(b)
    expect(warnings.some(w => w.includes('重复') || w.includes('duplicate'))).toBe(true)
  })

  it('校验永不抛错——即使输入完全为空', () => {
    const empty: KnowledgeBundle = {
      indicators: [], questions: [], archetypes: [], paths: [], blocks: {},
    }
    expect(() => validateKnowledge(empty)).not.toThrow()
  })
})

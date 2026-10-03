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
    boundaries: [],
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

  it('带 scores 的题不受「必须 5 个选项」约束', () => {
    const warnings = validateKnowledge(bundle({
      questions: [{
        id: 'grad-intention-1', text: '？', weight: 1,
        options: ['保研', '考研', '不读研', '还没想好'],
        scores: [
          { 'grad-intention-baoyan': 100, 'grad-intention-kaoyan': 0 },
          { 'grad-intention-baoyan': 0, 'grad-intention-kaoyan': 100 },
          {}, {},
        ],
      }],
      indicators: [
        { id: 'academic-interest', name: '学术志趣' },
        { id: 'grad-intention-baoyan', name: '保研意愿' },
        { id: 'grad-intention-kaoyan', name: '考研意愿' },
      ],
    }))
    expect(warnings.join()).not.toContain('个选项')
  })

  it('scores 与 options 长度不一致时给出警告', () => {
    const warnings = validateKnowledge(bundle({
      questions: [{
        id: 'grad-intention-1', text: '？', weight: 1,
        options: ['a', 'b', 'c'],
        scores: [{ 'grad-intention-baoyan': 1 }, { 'grad-intention-baoyan': 2 }],
      }],
      indicators: [{ id: 'grad-intention-baoyan', name: '保研意愿' }],
    }))
    expect(warnings.join()).toContain('scores')
  })

  it('只有多指标题的指标豁免「至少 3 道题」', () => {
    const warnings = validateKnowledge(bundle({
      questions: [{
        id: 'grad-intention-1', text: '？', weight: 1,
        options: ['a', 'b', 'c', 'd'],
        scores: [{ 'grad-intention-baoyan': 100 }, {}, {}, {}],
      }],
      indicators: [{ id: 'grad-intention-baoyan', name: '保研意愿' }],
    }))
    expect(warnings.join()).not.toContain('少于要求的')
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
      indicators: [], questions: [], archetypes: [], paths: [], blocks: {}, boundaries: [],
    }
    expect(() => validateKnowledge(empty)).not.toThrow()
  })
})

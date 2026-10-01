import { describe, it, expect } from 'vitest'
import { diagnose, findCloseMatches } from './diagnose.js'
import type { KnowledgeBundle, Question } from './types.js'

function q(id: string, indicator: string): Question {
  return { id, indicator: indicator as never, text: id, options: ['a','b','c','d','e'], weight: 1 }
}

function makeKnowledge(overrides: Partial<KnowledgeBundle> = {}): KnowledgeBundle {
  const base: KnowledgeBundle = {
    indicators: [{ id: 'academic-interest', name: '学术志趣' }],
    questions: [q('q1', 'academic-interest'), q('q2', 'academic-interest'), q('q3', 'academic-interest')],
    archetypes: [{
      id: 'steady-scholar', name: '稳健学术型',
      vector: { 'academic-interest': 90 },
      narrative: { oneLiner: '', strengths: [], blindspots: [] },
    }],
    paths: [{
      id: 'same-discipline-baoyan', title: '本学科保研',
      category: 'academic', span: 'same-discipline', status: 'verified',
      summary: '',
      weights: [{ indicator: 'academic-interest', weight: 1, ideal: 90 }],
      eligibility: [],
    }],
    blocks: {},
  }
  return { ...base, ...overrides }
}

const fullAnswers = { q1: 4, q2: 4, q3: 4 }

describe('diagnose', () => {
  it('串联全部环节并输出三个部分', () => {
    const result = diagnose(fullAnswers, makeKnowledge())
    expect(Object.keys(result.indicators)).toContain('academic-interest')
    expect(result.paths).toHaveLength(1)
    expect(result.archetypes[0]!.id).toBe('steady-scholar')
  })

  it('作答完全一致时置信度为 1', () => {
    const result = diagnose(fullAnswers, makeKnowledge())
    expect(result.paths[0]!.confidence).toBeCloseTo(1, 6)
  })

  it('空答案时全部路径 match 为 0、confidence 为 0，且不抛错', () => {
    const result = diagnose({}, makeKnowledge())
    expect(result.paths[0]!.match).toBe(0)
    expect(result.paths[0]!.confidence).toBe(0)
    expect(result.indicators['academic-interest']!.known).toBe(false)
  })

  it('hard 条件失败时路径仍出现在结果中，但 applicable 为 false', () => {
    const base = makeKnowledge()
    const knowledge = makeKnowledge({
      questions: [...base.questions, { ...q('elig-tuimian', 'academic-interest'), weight: 0 }],
      paths: [{
        ...base.paths[0]!,
        eligibility: [{
          id: 'has-tuimian-quota', questionId: 'elig-tuimian',
          severity: 'hard' as const,
          failMessage: '你的学校没有推免资格', passWhen: [0],
        }],
      }],
    })
    const result = diagnose({ ...fullAnswers, 'elig-tuimian': 1 }, knowledge)
    expect(result.paths).toHaveLength(1)
    expect(result.paths[0]!.eligibility.applicable).toBe(false)
    expect(result.paths[0]!.eligibility.hardFailures[0]!.message).toBe('你的学校没有推免资格')
  })

  it('所有路径都不适用时仍返回完整结果，不抛错也不返回空', () => {
    const base = makeKnowledge()
    const knowledge = makeKnowledge({
      questions: [...base.questions, { ...q('elig', 'academic-interest'), weight: 0 }],
      paths: [{
        ...base.paths[0]!,
        eligibility: [{
          id: 'x', questionId: 'elig', severity: 'hard' as const,
          failMessage: '不满足', passWhen: [0],
        }],
      }],
    })
    const result = diagnose({ ...fullAnswers, elig: 4 }, knowledge)
    expect(result.paths).toHaveLength(1)
    expect(result.paths[0]!.eligibility.applicable).toBe(false)
  })

  it('不适用路径的分项贡献一并归零，与 match: 0 自洽', () => {
    const base = makeKnowledge()
    const knowledge = makeKnowledge({
      questions: [...base.questions, { ...q('elig', 'academic-interest'), weight: 0 }],
      paths: [{
        ...base.paths[0]!,
        eligibility: [{
          id: 'x', questionId: 'elig', severity: 'hard' as const,
          failMessage: '不满足', passWhen: [0],
        }],
      }],
    })
    const path = diagnose({ ...fullAnswers, elig: 4 }, knowledge).paths[0]!
    expect(path.match).toBe(0)
    expect(path.contributions).toEqual([])
  })

  it('适用路径的分项贡献之和等于 match', () => {
    const path = diagnose(fullAnswers, makeKnowledge()).paths[0]!
    const sum = path.contributions.reduce((acc, c) => acc + c.contribution, 0)
    expect(sum).toBeCloseTo(path.match, 10)
  })

  it('路径按匹配度降序排列', () => {
    const base = makeKnowledge()
    const knowledge: KnowledgeBundle = {
      ...base,
      paths: [
        { ...base.paths[0]!, id: 'low', weights: [{ indicator: 'academic-interest', weight: 1, ideal: 0 }] },
        { ...base.paths[0]!, id: 'high', weights: [{ indicator: 'academic-interest', weight: 1, ideal: 100 }] },
      ],
    }
    const result = diagnose(fullAnswers, knowledge)
    expect(result.paths[0]!.id).toBe('high')
  })

  it('知识库为空时返回空结构而不是崩溃', () => {
    const empty: KnowledgeBundle = {
      indicators: [], questions: [], archetypes: [], paths: [], blocks: {},
    }
    const result = diagnose(fullAnswers, empty)
    expect(result.paths).toEqual([])
    expect(result.archetypes).toEqual([])
  })
})

describe('findCloseMatches', () => {
  it('找出与最高分差距在阈值内的路径', () => {
    const base = makeKnowledge()
    const result = diagnose(fullAnswers, {
      ...base,
      paths: [
        { ...base.paths[0]!, id: 'a', weights: [{ indicator: 'academic-interest', weight: 1, ideal: 100 }] },
        { ...base.paths[0]!, id: 'b', weights: [{ indicator: 'academic-interest', weight: 1, ideal: 98 }] },
        { ...base.paths[0]!, id: 'c', weights: [{ indicator: 'academic-interest', weight: 1, ideal: 10 }] },
      ],
    })
    const close = findCloseMatches(result, 5)
    expect(close.map(p => p.id).sort()).toEqual(['a', 'b'])
  })

  it('没有接近的路径时返回仅含最高分的那一条', () => {
    const result = diagnose(fullAnswers, makeKnowledge())
    expect(findCloseMatches(result, 5)).toHaveLength(1)
  })
})

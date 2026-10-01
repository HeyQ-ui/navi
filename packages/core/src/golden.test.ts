import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { diagnose } from './diagnose.js'
import { GOLDEN_CASES } from './fixtures/golden-cases.js'
import type { KnowledgeBundle } from './types.js'

const knowledgePath = new URL('../../knowledge/dist/knowledge.json', import.meta.url)
const hasKnowledge = existsSync(knowledgePath)
const bundle = hasKnowledge
  ? (JSON.parse(readFileSync(knowledgePath, 'utf8')) as KnowledgeBundle)
  : null

describe('黄金案例集', () => {
  it('知识库已编译', () => {
    if (!hasKnowledge) {
      console.warn('未找到 knowledge.json，跳过。请先运行 pnpm --filter @navi/knowledge build')
    }
    expect(hasKnowledge, '未找到 packages/knowledge/dist/knowledge.json，请先运行 pnpm --filter @navi/knowledge build').toBe(true)
  })

  it('每个案例的答案都指向真实存在的题目', () => {
    if (!bundle) return
    const questionIds = new Set(bundle.questions.map(q => q.id))

    for (const goldenCase of GOLDEN_CASES) {
      for (const questionId of Object.keys(goldenCase.answers)) {
        expect(
          questionIds.has(questionId),
          `案例「${goldenCase.name}」引用了不存在的题目 ${questionId}`,
        ).toBe(true)
      }
    }
  })

  it.each(GOLDEN_CASES.map(c => [c.name, c] as const))(
    '案例「%s」的首选推荐符合预期',
    (_name, goldenCase) => {
      if (!bundle) return
      const result = diagnose(goldenCase.answers, bundle)
      const applicable = result.paths.filter(p => p.eligibility.applicable)
      expect(applicable[0]?.id).toBe(goldenCase.expectTopPath)

      for (const pathId of goldenCase.expectPresent ?? []) {
        expect(result.paths.map(p => p.id)).toContain(pathId)
      }
    },
  )

  it('同一份答案重复诊断得到完全相同的结果（确定性）', () => {
    if (!bundle || GOLDEN_CASES.length === 0) return
    const first = diagnose(GOLDEN_CASES[0]!.answers, bundle)
    const second = diagnose(GOLDEN_CASES[0]!.answers, bundle)
    expect(JSON.stringify(first)).toBe(JSON.stringify(second))
  })
})

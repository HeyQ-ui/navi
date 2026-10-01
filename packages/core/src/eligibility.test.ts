import { describe, it, expect } from 'vitest'
import { evaluateEligibility } from './eligibility.js'
import type { EligibilityCondition } from './types.js'

const hard: EligibilityCondition = {
  id: 'has-tuimian-quota',
  questionId: 'eligibility-tuimian-quota',
  severity: 'hard',
  failMessage: '你的学校没有推免资格',
  passWhen: [0, 4],
}

const soft: EligibilityCondition = {
  id: 'gpa-threshold',
  questionId: 'eligibility-gpa',
  severity: 'soft',
  failMessage: '你的绩点距保研线较远',
  passWhen: [0, 1],
}

describe('evaluateEligibility', () => {
  it('全部通过时 applicable 为 true 且无失败项', () => {
    const r = evaluateEligibility([hard], { 'eligibility-tuimian-quota': 0 })
    expect(r.applicable).toBe(true)
    expect(r.hardFailures).toEqual([])
    expect(r.softWarnings).toEqual([])
  })

  it('hard 条件失败时 applicable 为 false 并记录原因', () => {
    const r = evaluateEligibility([hard], { 'eligibility-tuimian-quota': 1 })
    expect(r.applicable).toBe(false)
    expect(r.hardFailures).toHaveLength(1)
    expect(r.hardFailures[0]!.message).toBe('你的学校没有推免资格')
  })

  it('soft 条件失败时 applicable 仍为 true，仅记入警告', () => {
    const r = evaluateEligibility([soft], { 'eligibility-gpa': 3 })
    expect(r.applicable).toBe(true)
    expect(r.softWarnings).toHaveLength(1)
    expect(r.hardFailures).toEqual([])
  })

  it('未作答的题目视为不通过', () => {
    const r = evaluateEligibility([hard], {})
    expect(r.applicable).toBe(false)
    expect(r.hardFailures).toHaveLength(1)
  })

  it('多个 hard 失败时全部记录，而不是只报第一个', () => {
    const another: EligibilityCondition = { ...hard, id: 'another', failMessage: '另一条硬性不满足' }
    const r = evaluateEligibility([hard, another], { 'eligibility-tuimian-quota': 1 })
    expect(r.hardFailures).toHaveLength(2)
  })

  it('无条件时 applicable 为 true', () => {
    const r = evaluateEligibility([], {})
    expect(r.applicable).toBe(true)
  })
})

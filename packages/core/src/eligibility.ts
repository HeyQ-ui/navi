import type { Answers, EligibilityCondition, EligibilityFailure } from './types.js'

export interface EligibilityResult {
  applicable: boolean
  hardFailures: EligibilityFailure[]
  softWarnings: EligibilityFailure[]
}

/**
 * 资格过滤（设计文档 §7.5）。
 * hard 失败 → 路径标记为「不适用」；soft 失败 → 仅警告，路径保留。
 * 未作答的题目视为不通过。
 */
export function evaluateEligibility(
  conditions: EligibilityCondition[],
  answers: Answers,
): EligibilityResult {
  const hardFailures: EligibilityFailure[] = []
  const softWarnings: EligibilityFailure[] = []

  for (const condition of conditions) {
    const answer = answers[condition.questionId]
    const passed = answer !== undefined && condition.passWhen.includes(answer)
    if (passed) continue

    const failure: EligibilityFailure = {
      id: condition.id,
      severity: condition.severity,
      message: condition.failMessage,
    }

    if (condition.severity === 'hard') hardFailures.push(failure)
    else softWarnings.push(failure)
  }

  return { applicable: hardFailures.length === 0, hardFailures, softWarnings }
}

import type { DiagnosisResult, Question } from '@navi/core'

export type { DiagnosisResult, Question }
export type { PathResult, IndicatorScore, Contribution, EligibilityFailure } from '@navi/core'

/** 路径摘要——由 /api/questions 下发，不含内容块 */
export interface PathSummary {
  id: string
  title: string
  category: string
  span: string
  status: string
  summary: string
}

export interface QuestionsResponse {
  questions: Question[]
  indicators: Array<{ id: string; name: string }>
  paths: PathSummary[]
}

export async function fetchQuestions(): Promise<QuestionsResponse> {
  const res = await fetch('/api/questions')
  if (!res.ok) throw new Error(`获取问卷失败：${res.status}`)
  return (await res.json()) as QuestionsResponse
}

export async function postDiagnose(answers: Record<string, number>): Promise<DiagnosisResult> {
  const res = await fetch('/api/diagnose', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ answers }),
  })
  if (!res.ok) throw new Error(`诊断失败：${res.status}`)
  return (await res.json()) as DiagnosisResult
}

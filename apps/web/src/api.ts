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

export type Grade = 'freshman' | 'sophomore' | 'junior' | 'senior'

/** 诊断响应：结构化结果 + 与主推荐路径显示分相同的路径 id（设计文档 §9.3） */
export interface DiagnosisResponse extends DiagnosisResult {
  tiedPaths: string[]
}

export async function fetchQuestions(grade: Grade): Promise<QuestionsResponse> {
  const res = await fetch(`/api/questions?grade=${grade}`)
  if (!res.ok) throw new Error(`获取问卷失败：${res.status}`)
  return (await res.json()) as QuestionsResponse
}

export async function postDiagnose(
  answers: Record<string, number>,
  grade: Grade,
): Promise<DiagnosisResponse> {
  const res = await fetch('/api/diagnose', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ answers, grade }),
  })
  if (!res.ok) throw new Error(`诊断失败：${res.status}`)
  return (await res.json()) as DiagnosisResponse
}

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

/** 这次测的是谁。两者都会留存，但只有 self 的记录会用来给你解读（§4.2 第 1、4 条） */
export type AssessmentSource = 'self' | 'other'

/** 诊断响应：结构化结果 + 与主推荐路径显示分相同的路径 id（§9.3）+ 落库后的记录 id */
export interface DiagnosisResponse extends DiagnosisResult {
  tiedPaths: string[]
  assessmentId: string
}

export async function fetchQuestions(grade: Grade): Promise<QuestionsResponse> {
  const res = await fetch(`/api/questions?grade=${grade}`)
  if (!res.ok) throw new Error(`获取问卷失败：${res.status}`)
  return (await res.json()) as QuestionsResponse
}

export async function postDiagnose(
  answers: Record<string, number>,
  grade: Grade,
  source: AssessmentSource,
): Promise<DiagnosisResponse> {
  const res = await fetch('/api/diagnose', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ answers, grade, source }),
  })
  if (!res.ok) throw new Error(`诊断失败：${res.status}`)
  return (await res.json()) as DiagnosisResponse
}

export interface Account {
  id: string
  username: string
}

/** 非 2xx 时把服务端的错误文案抛出来，让调用方能直接显示 */
async function jsonOrThrow(res: Response, what: string): Promise<unknown> {
  if (res.ok) return res.json()
  const body = (await res.json().catch(() => ({}))) as { error?: string }
  throw new Error(body.error ?? `${what}失败：${res.status}`)
}

/** 未登录返回 null——调用方据此决定是进登录页还是进首页 */
export async function fetchMe(): Promise<Account | null> {
  const res = await fetch('/api/auth/me')
  if (res.status === 401) return null
  return (await jsonOrThrow(res, '获取账号')) as Account
}

export async function authenticate(
  mode: 'login' | 'register', username: string, password: string,
): Promise<Account> {
  const res = await fetch(`/api/auth/${mode}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  return (await jsonOrThrow(res, mode === 'login' ? '登录' : '注册')) as Account
}

export async function logout(): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST' })
}

export interface AssessmentSummary {
  id: string
  source: AssessmentSource
  grade: string | null
  createdAt: string
  mainPathId: string | null
  /** 服务端补好的中文路径名，前端不必再取一次 /api/questions */
  mainPathTitle: string | null
  match: number | null
}

export interface AssessmentDetail {
  id: string
  source: AssessmentSource
  grade: string | null
  createdAt: string
  answers: Record<string, number>
  result: DiagnosisResult
  interpretation: string | null
  mainPathId: string | null
  tiedPaths: string[]
  /** 自带路径摘要，历史详情因此只需一次请求 */
  paths: PathSummary[]
}

export async function fetchAssessments(): Promise<AssessmentSummary[]> {
  const res = await fetch('/api/assessments')
  const body = (await jsonOrThrow(res, '获取历史')) as { assessments: AssessmentSummary[] }
  return body.assessments
}

export async function fetchAssessment(id: string): Promise<AssessmentDetail> {
  const res = await fetch(`/api/assessments/${encodeURIComponent(id)}`)
  return (await jsonOrThrow(res, '获取测评记录')) as AssessmentDetail
}

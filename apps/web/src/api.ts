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
  // 走 jsonOrThrow 而不是只报状态码：题目没答全时服务端会指名哪几道题，
  // 那条信息对用户才有用
  return (await jsonOrThrow(res, '诊断')) as DiagnosisResponse
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
  const res = await fetch('/api/auth/logout', { method: 'POST' })
  // 非 2xx 必须抛：cookie 可能没清掉，调用方不能当成已登出（共享电脑上要紧）
  if (!res.ok) throw new Error(`登出失败：${res.status}`)
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

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  parts: Array<{ type: 'text'; text: string }>
}

/** 账号级对话历史。服务端按来源过滤，前端只是显示者 */
export async function fetchChatHistory(): Promise<ChatMessage[]> {
  const res = await fetch('/api/chat/history')
  const body = (await jsonOrThrow(res, '获取对话历史')) as {
    turns: Array<{ id: string; role: 'user' | 'assistant'; content: string }>
  }
  return body.turns.map(turn => ({
    id: turn.id,
    role: turn.role,
    parts: [{ type: 'text' as const, text: turn.content }],
  }))
}

/**
 * 只发本轮问题。历史由服务端持有，客户端上传的那份它一概不看——
 * 把整段历史传上去既多传了数据，又给了伪造的机会。
 */
export function buildChatBody(input: {
  assessmentId: string
  pathId: string
  messages: ChatMessage[]
}): { assessmentId: string; pathId: string; question: string } {
  const last = input.messages[input.messages.length - 1]
  const question = (last?.parts ?? [])
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map(p => p.text)
    .join('')
    .trim()
  return { assessmentId: input.assessmentId, pathId: input.pathId, question }
}

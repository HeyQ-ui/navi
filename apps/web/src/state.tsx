import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import {
  ApiHttpError, authenticate, fetchMe, fetchMeta, fetchQuestions, logout, postDiagnose,
} from './api.js'
import type {
  Account, AssessmentSource, DiagnosisResponse, Grade, MetaResponse, QuestionsResponse,
} from './api.js'

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

export interface FlowValue {
  account: Account | null
  authReady: boolean
  /** 会话探测失败的原因，原样来自服务端——显示时不得改写 */
  authError: string
  signIn(mode: 'login' | 'register', username: string, password: string): Promise<void>
  signOut(): Promise<void>

  source: AssessmentSource
  /** 从首页点「测测自己/测测别人」：换一次测评，此前作答与结果全部作废 */
  startAssessment(source: AssessmentSource): void

  grade: Grade | null
  data: QuestionsResponse | null
  questionsLoading: boolean
  questionsError: string
  /** 'ok' 进问卷；'empty' 题目为空（信息不足，留在年级页）；'error' 取题失败（questionsError 已置） */
  chooseGrade(grade: Grade): Promise<'ok' | 'empty' | 'error'>

  answers: Record<string, number>
  setAnswer(questionId: string, optionIndex: number): void

  result: DiagnosisResponse | null
  submitting: boolean
  submitError: string
  /** 'ok' 跳结果页；'auth' 会话失效（已置好回跳 /quiz）；'error' 原地显示 submitError */
  submit(): Promise<'ok' | 'auth' | 'error'>
  /** 提交时撞 401 → 登录回来后问卷页自动重提一次，不重新答题（spec §4.2） */
  resubmitAfterLogin: boolean

  /** 登录成功后去哪；进 /auth 前由调用方置好 */
  authRedirect: string | null
  setAuthRedirect(to: string | null): void
}

const FlowContext = createContext<FlowValue | null>(null)

export function FlowProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<Account | null>(null)
  const [authReady, setAuthReady] = useState(false)
  const [authError, setAuthError] = useState('')
  const [source, setSource] = useState<AssessmentSource>('self')
  const [grade, setGrade] = useState<Grade | null>(null)
  const [data, setData] = useState<QuestionsResponse | null>(null)
  const [questionsLoading, setQuestionsLoading] = useState(false)
  const [questionsError, setQuestionsError] = useState('')
  const [answers, setAnswers] = useState<Record<string, number>>({})
  const [result, setResult] = useState<DiagnosisResponse | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [resubmitAfterLogin, setResubmitAfterLogin] = useState(false)
  const [authRedirect, setAuthRedirect] = useState<string | null>(null)

  useEffect(() => {
    void fetchMe()
      .then(me => { if (me !== null) setAccount(me) })
      .catch((error: unknown) => setAuthError(messageOf(error, '无法连接服务端，请稍后重试')))
      .finally(() => setAuthReady(true))
  }, [])

  const signIn = useCallback(
    async (mode: 'login' | 'register', username: string, password: string) => {
      setAccount(await authenticate(mode, username, password))
    },
    [],
  )

  const signOut = useCallback(async () => {
    // 只有服务端确认清了 cookie 才清状态：「以为登出了、其实没有」比登出失败更危险
    await logout()
    setAccount(null)
    setSource('self')
    setGrade(null)
    setData(null)
    setAnswers({})
    setResult(null)
    setSubmitError('')
    setResubmitAfterLogin(false)
    setAuthRedirect(null)
  }, [])

  const startAssessment = useCallback((src: AssessmentSource) => {
    setSource(src)
    setGrade(null)
    setData(null)
    setAnswers({})
    setResult(null)
    setQuestionsError('')
    setSubmitError('')
  }, [])

  const chooseGrade = useCallback(async (g: Grade): Promise<'ok' | 'empty' | 'error'> => {
    setGrade(g)
    setData(null)
    setAnswers({})
    setQuestionsLoading(true)
    setQuestionsError('')
    try {
      const data = await fetchQuestions(g)
      setData(data)
      // 空题目不能进问卷：提交必然撞 400。「有没有题」由 provider 判断，
      // 页面组件在 await 之后读 flow.data 只会拿到上一轮渲染的旧快照
      return data.questions.length > 0 ? 'ok' : 'empty'
    } catch (error) {
      setQuestionsError(messageOf(error, '加载失败'))
      return 'error'
    } finally {
      setQuestionsLoading(false)
    }
  }, [])

  const setAnswer = useCallback((questionId: string, optionIndex: number) => {
    setAnswers(prev => ({ ...prev, [questionId]: optionIndex }))
  }, [])

  const submit = useCallback(async (): Promise<'ok' | 'auth' | 'error'> => {
    if (grade === null) return 'error'
    setSubmitting(true)
    setSubmitError('')
    try {
      setResult(await postDiagnose(answers, grade, source))
      setResubmitAfterLogin(false)
      return 'ok'
    } catch (error) {
      if (error instanceof ApiHttpError && error.status === 401) {
        // 会话在答题中途失效：记住回跳点，登录后自动重提，不重新答题（spec §4.2）
        setResubmitAfterLogin(true)
        setAuthRedirect('/quiz')
        return 'auth'
      }
      setSubmitError(messageOf(error, '诊断失败'))
      return 'error'
    } finally {
      setSubmitting(false)
    }
  }, [answers, grade, source])

  return (
    <FlowContext.Provider
      value={{
        account, authReady, authError, signIn, signOut,
        source, startAssessment,
        grade, data, questionsLoading, questionsError, chooseGrade,
        answers, setAnswer,
        result, submitting, submitError, submit, resubmitAfterLogin,
        authRedirect, setAuthRedirect,
      }}
    >
      {children}
    </FlowContext.Provider>
  )
}

export function useFlow(): FlowValue {
  const value = useContext(FlowContext)
  if (value === null) throw new Error('useFlow 必须在 FlowProvider 内使用')
  return value
}

/** /api/meta 全应用只取一次；失败清掉缓存允许下次重试 */
let metaPromise: Promise<MetaResponse> | null = null

export function loadMeta(): Promise<MetaResponse> {
  metaPromise ??= fetchMeta().catch((error: unknown) => {
    metaPromise = null
    throw error
  })
  return metaPromise
}

export function useMeta(): { meta: MetaResponse | null; error: string } {
  const [meta, setMeta] = useState<MetaResponse | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let cancelled = false
    void loadMeta()
      .then(m => { if (!cancelled) setMeta(m) })
      .catch((e: unknown) => { if (!cancelled) setError(messageOf(e, '加载失败')) })
    return () => { cancelled = true }
  }, [])
  return { meta, error }
}

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import type { ReactNode } from 'react'
import { fetchMe, fetchQuestions, logout, postDiagnose } from './api.js'
import { ApiHttpError } from './api.js'
import { FlowProvider, useFlow } from './state.js'

vi.mock('./api.js', async () => {
  const actual = await vi.importActual<typeof import('./api.js')>('./api.js')
  return {
    ...actual,
    fetchMe: vi.fn(),
    fetchQuestions: vi.fn(),
    postDiagnose: vi.fn(),
    authenticate: vi.fn(),
    logout: vi.fn(),
    fetchMeta: vi.fn(),
  }
})

const wrapper = ({ children }: { children: ReactNode }) => <FlowProvider>{children}</FlowProvider>

const diagnosis = {
  indicators: {}, paths: [], archetypes: [], tiedPaths: [], assessmentId: 'a1',
}

beforeEach(() => {
  vi.mocked(fetchMe).mockResolvedValue(null)
  vi.mocked(fetchQuestions).mockResolvedValue({ questions: [], indicators: [], paths: [] })
  vi.mocked(postDiagnose).mockResolvedValue(diagnosis)
  vi.mocked(logout).mockResolvedValue(undefined)
})

describe('FlowProvider · 会话探测', () => {
  it('已登录时带出账号', async () => {
    vi.mocked(fetchMe).mockResolvedValue({ id: 'u1', username: 'tester' })
    const { result } = renderHook(() => useFlow(), { wrapper })
    await waitFor(() => expect(result.current.authReady).toBe(true))
    expect(result.current.account?.username).toBe('tester')
  })

  it('探测失败时原样保留服务端原因——泛化文案会误导排查方向', async () => {
    vi.mocked(fetchMe).mockRejectedValue(new Error('账号功能暂不可用：服务端未配置会话密钥'))
    const { result } = renderHook(() => useFlow(), { wrapper })
    await waitFor(() => expect(result.current.authReady).toBe(true))
    expect(result.current.authError).toBe('账号功能暂不可用：服务端未配置会话密钥')
  })

  it('抛出非 Error 时用一句兜底文案', async () => {
    vi.mocked(fetchMe).mockRejectedValue('boom')
    const { result } = renderHook(() => useFlow(), { wrapper })
    await waitFor(() => expect(result.current.authReady).toBe(true))
    expect(result.current.authError).toBe('无法连接服务端，请稍后重试')
  })
})

describe('FlowProvider · 登出', () => {
  it('成功后清空状态；失败抛出且不假装已登出', async () => {
    vi.mocked(fetchMe).mockResolvedValue({ id: 'u1', username: 'tester' })
    const { result } = renderHook(() => useFlow(), { wrapper })
    await waitFor(() => expect(result.current.account).not.toBeNull())

    vi.mocked(logout).mockRejectedValue(new Error('登出失败：500'))
    // 在 act 内部捕获错误而不是让 act 本身拒绝：React 18.3 的 act 在
    // 拒绝路径不清理内部队列，会把后续 act 的冲刷一并弄坏
    let caught: unknown = null
    await act(async () => {
      try { await result.current.signOut() } catch (e) { caught = e }
    })
    expect(caught).toBeInstanceOf(Error)
    expect((caught as Error).message).toBe('登出失败：500')
    expect(result.current.account).not.toBeNull()

    vi.mocked(logout).mockResolvedValue(undefined)
    await act(async () => { await result.current.signOut() })
    expect(result.current.account).toBeNull()
  })
})

describe('FlowProvider · 答题流', () => {
  it('选年级取题：有题返回 ok，空题返回 empty，失败返回 error 且文案透出', async () => {
    const { result } = renderHook(() => useFlow(), { wrapper })
    await waitFor(() => expect(result.current.authReady).toBe(true))

    // beforeEach 的 mock 返回空题目——这正是「信息不足」态，不能放进问卷
    await act(async () => { expect(await result.current.chooseGrade('freshman')).toBe('empty') })
    expect(result.current.data).toEqual({ questions: [], indicators: [], paths: [] })

    vi.mocked(fetchQuestions).mockResolvedValue({
      questions: [{ id: 'q1', text: 't', options: ['a'], weight: 1 }],
      indicators: [], paths: [],
    })
    await act(async () => { expect(await result.current.chooseGrade('freshman')).toBe('ok') })

    vi.mocked(fetchQuestions).mockRejectedValue(new Error('获取问卷失败：500'))
    await act(async () => { expect(await result.current.chooseGrade('sophomore')).toBe('error') })
    expect(result.current.questionsError).toBe('获取问卷失败：500')
  })

  it('换年级与开始新测评都会清空作答——作答只属于这一次测试', async () => {
    vi.mocked(fetchQuestions).mockResolvedValue({
      questions: [{ id: 'q1', text: 't', options: ['a'], weight: 1 }],
      indicators: [], paths: [],
    })
    const { result } = renderHook(() => useFlow(), { wrapper })
    await act(async () => { await result.current.chooseGrade('freshman') })
    act(() => result.current.setAnswer('q1', 2))
    expect(result.current.answers).toEqual({ q1: 2 })

    await act(async () => { await result.current.chooseGrade('junior') })
    expect(result.current.answers).toEqual({})
  })
})

describe('FlowProvider · 提交', () => {
  async function readyFlow() {
    const { result } = renderHook(() => useFlow(), { wrapper })
    await waitFor(() => expect(result.current.authReady).toBe(true))
    await act(async () => { await result.current.chooseGrade('freshman') })
    return result
  }

  it('成功时存结果并返回 ok', async () => {
    const result = await readyFlow()
    let outcome: string = ''
    await act(async () => { outcome = await result.current.submit() })
    expect(outcome).toBe('ok')
    expect(result.current.result?.assessmentId).toBe('a1')
  })

  it('401（会话失效）返回 auth 并记下回跳重提，其余错误返回 error 且文案透出', async () => {
    const result = await readyFlow()

    vi.mocked(postDiagnose).mockRejectedValue(new ApiHttpError('未登录', 401))
    let outcome = ''
    await act(async () => { outcome = await result.current.submit() })
    expect(outcome).toBe('auth')
    expect(result.current.resubmitAfterLogin).toBe(true)
    expect(result.current.authRedirect).toBe('/quiz')

    vi.mocked(postDiagnose).mockRejectedValue(new ApiHttpError('以下题目未作答：q2', 400))
    await act(async () => { outcome = await result.current.submit() })
    expect(outcome).toBe('error')
    expect(result.current.submitError).toBe('以下题目未作答：q2')
  })
})

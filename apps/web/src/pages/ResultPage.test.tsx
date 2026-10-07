import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useRef } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fetchMe, fetchQuestions, postDiagnose } from '../api.js'
import { FlowProvider, useFlow } from '../state.js'
import { ResultPage } from './ResultPage.js'

vi.mock('../api.js', async () => {
  const actual = await vi.importActual<typeof import('../api.js')>('../api.js')
  return {
    ...actual,
    fetchMe: vi.fn(), fetchQuestions: vi.fn(), postDiagnose: vi.fn(),
    authenticate: vi.fn(), logout: vi.fn(), fetchMeta: vi.fn(),
  }
})

// ResultBody 已有自己的测试——这里只验证页面把正确的数据交给它
vi.mock('../components/ResultBody.js', () => ({
  ResultBody: ({ assessmentId }: { assessmentId: string }) => (
    <div data-testid="result-body">{assessmentId}</div>
  ),
}))

/**
 * 结果页只读 state 里的结果——探针负责把「选年级 → 提交」走一遍。
 * 用 ref 持有「最新一次渲染」的 flow：chooseGrade 会改 grade，之后的提交必须走绑定
 * 到刷新后 grade 的 submit；直接闭包捕获点击时的 flow 会拿到 grade 仍为 null 的旧
 * submit（它第一行就 `return 'error'`），结果永远进不了 state。
 */
function RunProbe() {
  const flow = useFlow()
  const latest = useRef(flow)
  latest.current = flow
  async function run() {
    await latest.current.chooseGrade('freshman')
    await latest.current.submit()
  }
  return <button type="button" onClick={() => void run()}>走一遍流程</button>
}

beforeEach(() => {
  window.history.pushState({}, '', '/result')
  vi.mocked(fetchMe).mockResolvedValue({ id: 'u1', username: 'tester' })
  vi.mocked(fetchQuestions).mockResolvedValue({
    questions: [{ id: 'q1', text: 't', options: ['a'], weight: 1 }],
    indicators: [], paths: [],
  })
  vi.mocked(postDiagnose).mockResolvedValue({
    indicators: {}, paths: [], archetypes: [], tiedPaths: [], assessmentId: 'a1',
  })
})

describe('ResultPage', () => {
  it('没有结果时回首页——结果只存内存，刷新即失效（spec §4.2）', async () => {
    render(<FlowProvider><ResultPage /></FlowProvider>)
    await waitFor(() => expect(window.location.pathname).toBe('/'))
  })

  it('有结果时把记录交给 ResultBody', async () => {
    render(<FlowProvider><ResultPage /><RunProbe /></FlowProvider>)
    await userEvent.click(await screen.findByRole('button', { name: '走一遍流程' }))
    expect(await screen.findByTestId('result-body')).toHaveTextContent('a1')
  })

  it('提交在途时给骨架，不把刚交完卷的人弹回封面', async () => {
    // 与问卷页同一时序：navigate('/result') 的位置更新经 useSyncExternalStore
    // 以同步优先级提交，会先于 submit 里那次 setResult 落地——这一瞬间 result
    // 仍是 null。守卫若把「结果在路上」当成「没有结果」，用户交完卷就被弹回封面。
    // 真实时序：交卷发生在问卷页，路由切到 /result 后结果页才挂载。
    function Gate() {
      const flow = useFlow()
      return flow.submitting || flow.result !== null ? <ResultPage /> : null
    }
    vi.mocked(postDiagnose).mockReturnValue(new Promise(() => {}))
    const { container } = render(<FlowProvider><Gate /><RunProbe /></FlowProvider>)
    await userEvent.click(await screen.findByRole('button', { name: '走一遍流程' }))
    await waitFor(() => expect(container.querySelector('.skeleton')).not.toBeNull())
    expect(window.location.pathname).toBe('/result')
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { authenticate, fetchAssessments, fetchMe } from '../api.js'
import type { Account, AssessmentSummary } from '../api.js'
import { FlowProvider, useFlow } from '../state.js'
import { HistoryPage } from './HistoryPage.js'

vi.mock('../api.js', async () => {
  const actual = await vi.importActual<typeof import('../api.js')>('../api.js')
  return {
    ...actual,
    fetchMe: vi.fn(), fetchAssessments: vi.fn(),
    authenticate: vi.fn(), logout: vi.fn(), fetchMeta: vi.fn(),
  }
})

const rows: AssessmentSummary[] = [
  {
    id: 'a1', source: 'self', grade: 'freshman', createdAt: '2026-10-06T08:30:00.000Z',
    mainPathId: 'same-discipline-baoyan', mainPathTitle: '本学科保研', match: 78,
    archetypeName: '稳健学术型',
  },
  {
    id: 'a2', source: 'other', grade: null, createdAt: '2026-09-01T08:30:00.000Z',
    mainPathId: null, mainPathTitle: null, match: null, archetypeName: null,
  },
]

function renderPage() {
  return render(<FlowProvider><HistoryPage /></FlowProvider>)
}

beforeEach(() => {
  window.history.pushState({}, '', '/history')
  vi.mocked(fetchMe).mockResolvedValue({ id: 'u1', username: 'tester' })
  vi.mocked(fetchAssessments).mockResolvedValue(rows)
})

describe('HistoryPage', () => {
  it('未登录访问 /history 时引导登录（spec §4.1）', async () => {
    vi.mocked(fetchMe).mockResolvedValue(null)
    renderPage()
    await waitFor(() => expect(window.location.pathname).toBe('/auth'))
    expect(fetchAssessments).not.toHaveBeenCalled()
  })

  it('会话探测未完成时只显示骨架、不跳转（spec §4.1）', () => {
    vi.mocked(fetchMe).mockReturnValue(new Promise<Account | null>(() => {}))
    const { container } = renderPage()
    expect(container.querySelector('.skeleton')).not.toBeNull()
    expect(window.location.pathname).toBe('/history')
  })

  it('登录请求在途时给骨架，不把刚登录成功的人送回登录页', async () => {
    // 与问卷页同一时序：navigate('/history') 的位置更新经 useSyncExternalStore
    // 以同步优先级提交，会先于 signIn 里那次 setAccount 落地——这一瞬间 account
    // 仍是 null。守卫若把「账号在路上」当成「未登录」，用户会在登录成功后被送回
    // 登录页。真实时序：登录发生在登录页，路由切到 /history 后历史页才挂载。
    function Gate() {
      const flow = useFlow()
      return flow.signingIn || flow.account !== null ? <HistoryPage /> : null
    }
    function LoginProbe() {
      const flow = useFlow()
      return (
        <button type="button" onClick={() => void flow.signIn('login', 'tester', 'secret')}>
          走一遍登录
        </button>
      )
    }
    vi.mocked(fetchMe).mockResolvedValue(null)
    vi.mocked(authenticate).mockReturnValue(new Promise(() => {}))
    const { container } = render(
      <FlowProvider><Gate /><LoginProbe /></FlowProvider>,
    )
    await userEvent.click(await screen.findByRole('button', { name: '走一遍登录' }))
    await waitFor(() => expect(container.querySelector('.skeleton')).not.toBeNull())
    expect(window.location.pathname).toBe('/history')
  })

  it('列表行：日期块、主推荐标题、元信息行与匹配分（spec §5.7）', async () => {
    renderPage()
    const link = await screen.findByRole('link', { name: /本学科保研/ })
    expect(link).toHaveAttribute('href', '/history/a1')
    expect(screen.getByText('6')).toBeInTheDocument()
    expect(link).toHaveTextContent('2026 · 10')
    expect(link).toHaveTextContent('测测自己 · 大一 · 稳健学术型')
    expect(link).toHaveTextContent('78')
    await waitFor(() => expect(document.title).toBe('历史 · Navi'))
  })

  it('字段缺失时如实降级：无主推荐、元信息只剩来源、不显示分数（spec §5.7）', async () => {
    renderPage()
    const link = await screen.findByRole('link', { name: /无主推荐/ })
    expect(link).toHaveAttribute('href', '/history/a2')
    expect(link).toHaveTextContent('临时测试')
    expect(link).not.toHaveTextContent('临时测试 ·')
    expect(link).not.toHaveTextContent('78')
  })

  it('空态文案与去做测评入口（spec §5.7）', async () => {
    vi.mocked(fetchAssessments).mockResolvedValue([])
    renderPage()
    expect(await screen.findByText('还没有记录')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '做一次测评' })).toHaveAttribute('href', '/')
  })

  it('列表加载中显示暖纸色骨架屏（spec §7.1）', async () => {
    vi.mocked(fetchAssessments).mockReturnValue(new Promise<AssessmentSummary[]>(() => {}))
    const { container } = renderPage()
    await screen.findByRole('heading', { name: '你的历史' })
    expect(container.querySelector('.skeleton')).not.toBeNull()
  })

  it('列表取失败时内联错误并可重试（不弹框，spec §7.2）', async () => {
    vi.mocked(fetchAssessments).mockRejectedValueOnce(new Error('获取历史失败：500'))
    renderPage()
    expect(await screen.findByText('获取历史失败：500')).toBeInTheDocument()
    vi.mocked(fetchAssessments).mockResolvedValueOnce(rows)
    await userEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(await screen.findByRole('link', { name: /本学科保研/ })).toBeInTheDocument()
  })
})

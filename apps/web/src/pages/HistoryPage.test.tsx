import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fetchAssessments, fetchMe } from '../api.js'
import type { Account, AssessmentSummary } from '../api.js'
import { FlowProvider } from '../state.js'
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
    expect(link).toHaveTextContent('测测别人')
    expect(link).not.toHaveTextContent('测测别人 ·')
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

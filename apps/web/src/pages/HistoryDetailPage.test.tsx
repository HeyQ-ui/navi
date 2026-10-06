import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fetchAssessment, fetchMe } from '../api.js'
import type { AssessmentDetail } from '../api.js'
import { FlowProvider } from '../state.js'
import { HistoryDetailPage } from './HistoryDetailPage.js'

vi.mock('../api.js', async () => {
  const actual = await vi.importActual<typeof import('../api.js')>('../api.js')
  return {
    ...actual,
    fetchMe: vi.fn(), fetchAssessment: vi.fn(),
    authenticate: vi.fn(), logout: vi.fn(), fetchMeta: vi.fn(),
  }
})

// ResultBody 已有自己的测试——这里只验证页面把记录快照原样交下去
vi.mock('../components/ResultBody.js', () => ({
  ResultBody: ({ assessmentId, paths, tiedPaths, interpretation }: {
    assessmentId: string
    paths: unknown[]
    tiedPaths: string[]
    interpretation: string | null
  }) => (
    <div data-testid="result-body">
      {assessmentId} · {paths.length} 条路径 · {tiedPaths.length} 并列 · {interpretation ?? '无解读'}
    </div>
  ),
}))

const detail: AssessmentDetail = {
  id: 'a1', source: 'self', grade: 'freshman', createdAt: '2026-10-06T08:30:00.000Z',
  answers: { q1: 0 },
  result: { indicators: {}, paths: [], archetypes: [] },
  interpretation: '这一段解读原样带回',
  mainPathId: 'same-discipline-baoyan',
  tiedPaths: ['civil-service'],
  paths: [
    {
      id: 'same-discipline-baoyan', title: '本学科保研', category: 'academic',
      span: 'same-discipline', status: 'verified', summary: '',
    },
    {
      id: 'civil-service', title: '考公考编 / 选调生', category: 'civil',
      span: 'same-discipline', status: 'draft', summary: '',
    },
  ],
}

function renderPage() {
  return render(<FlowProvider><HistoryDetailPage recordId="a1" /></FlowProvider>)
}

beforeEach(() => {
  window.history.pushState({}, '', '/history/a1')
  vi.mocked(fetchMe).mockResolvedValue({ id: 'u1', username: 'tester' })
  vi.mocked(fetchAssessment).mockResolvedValue(detail)
})

describe('HistoryDetailPage', () => {
  it('未登录访问记录详情时引导登录（spec §4.1）', async () => {
    vi.mocked(fetchMe).mockResolvedValue(null)
    renderPage()
    await waitFor(() => expect(window.location.pathname).toBe('/auth'))
    expect(fetchAssessment).not.toHaveBeenCalled()
  })

  it('顶部回到历史链接、页头日期与来源（spec §5.7）', async () => {
    renderPage()
    expect(await screen.findByRole('link', { name: /回到历史/ })).toHaveAttribute('href', '/history')
    expect(screen.getByText(/2026年10月6日 · 测测自己/)).toBeInTheDocument()
    await waitFor(() => expect(document.title).toBe('测评记录 · Navi'))
  })

  it('把记录快照原样交给 ResultBody（spec §5.7）', async () => {
    renderPage()
    expect(await screen.findByTestId('result-body'))
      .toHaveTextContent('a1 · 2 条路径 · 1 并列 · 这一段解读原样带回')
  })

  it('加载中显示暖纸色骨架屏（spec §7.1）', async () => {
    vi.mocked(fetchAssessment).mockReturnValue(new Promise<AssessmentDetail>(() => {}))
    const { container } = renderPage()
    await waitFor(() => expect(fetchAssessment).toHaveBeenCalledWith('a1'))
    expect(container.querySelector('.skeleton')).not.toBeNull()
  })

  it('加载失败时内联错误并可重试与返回（不弹框，spec §7.2）', async () => {
    vi.mocked(fetchAssessment).mockRejectedValueOnce(new Error('记录不存在：nope'))
    renderPage()
    expect(await screen.findByText('记录不存在：nope')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /回到历史/ })).toHaveAttribute('href', '/history')
    vi.mocked(fetchAssessment).mockResolvedValueOnce(detail)
    await userEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(await screen.findByTestId('result-body')).toBeInTheDocument()
  })
})

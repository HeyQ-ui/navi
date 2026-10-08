import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fetchMe, fetchOverview, fetchPathKnowledge, fetchQuestions, fetchReferences } from './api.js'
import { App } from './App.js'

vi.mock('./api.js', async () => {
  const actual = await vi.importActual<typeof import('./api.js')>('./api.js')
  return {
    ...actual,
    fetchMe: vi.fn(), fetchQuestions: vi.fn(), postDiagnose: vi.fn(),
    authenticate: vi.fn(), logout: vi.fn(), fetchMeta: vi.fn(), fetchPathKnowledge: vi.fn(),
    fetchOverview: vi.fn(), fetchReferences: vi.fn(),
  }
})

beforeEach(() => {
  vi.mocked(fetchMe).mockResolvedValue(null)
})

describe('App 路由外壳', () => {
  it('/ 渲染首页与顶栏', async () => {
    window.history.pushState({}, '', '/')
    render(<App />)
    expect(await screen.findByRole('heading', { name: '大学生生涯规划Agent' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Navi/ })).toHaveAttribute('href', '/')
  })

  it('未知路由重定向回首页——兜底不给 404 态', async () => {
    window.history.pushState({}, '', '/no-such-route')
    render(<App />)
    await waitFor(() => expect(window.location.pathname).toBe('/'))
    expect(await screen.findByRole('heading', { name: '大学生生涯规划Agent' })).toBeInTheDocument()
  })

  it('年级选定且题目非空时进入问卷，而不是被问卷守卫弹回首页', async () => {
    vi.mocked(fetchMe).mockResolvedValue({ id: 'u1', username: 'tester' })
    vi.mocked(fetchQuestions).mockResolvedValue({
      questions: [{ id: 'q1', text: '题目1', options: ['甲'], weight: 1 }],
      indicators: [], paths: [],
    })
    window.history.pushState({}, '', '/grade')
    render(<App />)
    await userEvent.click(await screen.findByRole('button', { name: '大一' }))
    await waitFor(() => expect(window.location.pathname).toBe('/quiz'))
    // 守卫若把这次跳转当成「无答题上下文」，页面会立刻被弹回首页
    expect(await screen.findByText('题目1')).toBeInTheDocument()
    expect(window.location.pathname).toBe('/quiz')
  })

  it('/path/:pathId 把路由参数交给路径详情页', async () => {
    vi.mocked(fetchPathKnowledge).mockResolvedValue({
      path: {
        id: 'same-discipline-baoyan', title: '本学科保研', category: 'academic',
        span: 'same-discipline', status: 'verified', summary: '',
        weights: [], eligibility: [],
      },
      blocks: [],
    })
    window.history.pushState({}, '', '/path/same-discipline-baoyan')
    render(<App />)
    expect(await screen.findByRole('heading', { name: '本学科保研' })).toBeInTheDocument()
  })

  it('/paths 渲染路径总览（免登录）', async () => {
    vi.mocked(fetchMe).mockResolvedValue(null)
    vi.mocked(fetchOverview).mockResolvedValue({ paths: [], common: [] })
    window.history.pushState({}, '', '/paths')
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Navi的知识库' })).toBeInTheDocument()
  })

  it('/references 渲染参考文献页（免登录）', async () => {
    vi.mocked(fetchMe).mockResolvedValue(null)
    vi.mocked(fetchReferences).mockResolvedValue({
      blocks: [{ type: 'references', html: '<p>来源清单</p>', raw: '来源清单' }],
    })
    window.history.pushState({}, '', '/references')
    render(<App />)
    expect(await screen.findByRole('heading', { name: '参考文献' })).toBeInTheDocument()
  })
})

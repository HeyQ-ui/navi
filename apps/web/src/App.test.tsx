import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { fetchMe, fetchPathKnowledge } from './api.js'
import { App } from './App.js'

vi.mock('./api.js', async () => {
  const actual = await vi.importActual<typeof import('./api.js')>('./api.js')
  return {
    ...actual,
    fetchMe: vi.fn(), fetchQuestions: vi.fn(), postDiagnose: vi.fn(),
    authenticate: vi.fn(), logout: vi.fn(), fetchMeta: vi.fn(), fetchPathKnowledge: vi.fn(),
  }
})

beforeEach(() => {
  vi.mocked(fetchMe).mockResolvedValue(null)
})

describe('App 路由外壳', () => {
  it('/ 渲染首页与顶栏', async () => {
    window.history.pushState({}, '', '/')
    render(<App />)
    expect(await screen.findByRole('heading', { name: /先看清自己，再看清/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Navi/ })).toHaveAttribute('href', '/')
  })

  it('未知路由重定向回首页——兜底不给 404 态', async () => {
    window.history.pushState({}, '', '/no-such-route')
    render(<App />)
    await waitFor(() => expect(window.location.pathname).toBe('/'))
    expect(await screen.findByRole('heading', { name: /先看清自己，再看清/ })).toBeInTheDocument()
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
})

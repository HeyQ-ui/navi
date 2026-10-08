import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fetchOverview } from '../api.js'
import type { OverviewResponse } from '../api.js'
import { PathsPage } from './PathsPage.js'

vi.mock('../api.js', async () => {
  const actual = await vi.importActual<typeof import('../api.js')>('../api.js')
  return { ...actual, fetchOverview: vi.fn(), fetchMe: vi.fn(), fetchMeta: vi.fn() }
})

const overview: OverviewResponse = {
  paths: [
    { id: 'civil-service', title: '考公考编', category: 'public', span: 'civil-service', status: 'verified', summary: '体制内' },
    { id: 'cross-discipline-baoyan', title: '跨学科保研', category: 'academic', span: 'cross-discipline', status: 'draft', summary: '跨专业' },
    { id: 'cross-discipline-job', title: '跨学科就业', category: 'employment', span: 'cross-discipline', status: 'verified', summary: '转行' },
    { id: 'cross-discipline-kaoyan', title: '跨学科考研', category: 'academic', span: 'cross-discipline', status: 'verified', summary: '跨考' },
    { id: 'same-discipline-baoyan', title: '本学科保研', category: 'academic', span: 'same-discipline', status: 'verified', summary: '保研' },
    { id: 'same-discipline-job', title: '本学科就业', category: 'employment', span: 'same-discipline', status: 'verified', summary: '就业' },
    { id: 'same-discipline-kaoyan', title: '本学科考研', category: 'academic', span: 'same-discipline', status: 'verified', summary: '考研' },
  ],
  common: [
    { type: 'myth', title: '目标真空、盲目跟风', html: '<p>随大流决定考研 / 考公 / 保研。</p>', raw: '目标真空、盲目跟风' },
    { type: 'compare', title: '七条路径差异对比', html: '<table><tr><td>竞争性质</td></tr></table>', raw: '七条路径差异对比' },
  ],
}

function renderPage() {
  return render(<PathsPage />)
}

beforeEach(() => {
  window.history.pushState({}, '', '/paths')
  vi.mocked(fetchOverview).mockResolvedValue(overview)
})

describe('PathsPage', () => {
  it('七条路径入口 + 两段通用知识（spec §5.8）', async () => {
    renderPage()
    expect(await screen.findByRole('heading', { name: 'Navi的知识库' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '七条路径' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '大一新生常见误区' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '七条路径横向对比' })).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: /保研|考研|考公考编|就业/ })).toHaveLength(7)
    // 通用块按知识库内顺序渲染：误区在前，对比在后
    expect(screen.getByText('目标真空、盲目跟风')).toBeInTheDocument()
    expect(screen.getByText('七条路径差异对比')).toBeInTheDocument()
  })

  it('浏览态不出现匹配条与分数——没有测评就没有这些数（spec §5.8）', async () => {
    const { container } = renderPage()
    await screen.findByRole('heading', { name: '七条路径' })
    expect(container.querySelector('.bg-ink-3')).toBeNull()
    expect(container.querySelector('.bg-line')).toBeNull()
  })

  it('每行指向各自详情页并带上来源标记，draft 路径带待核实角标（spec §3.6、§5.6）', async () => {
    renderPage()
    expect(await screen.findByRole('link', { name: /本学科保研/ }))
      .toHaveAttribute('href', '/path/same-discipline-baoyan?from=paths')
    expect(screen.getByRole('link', { name: /跨学科保研/ }))
      .toHaveAttribute('href', '/path/cross-discipline-baoyan?from=paths')
    expect(screen.getByText('待核实')).toBeInTheDocument()
  })

  it('页头有返回首页入口（spec §5.8）', async () => {
    renderPage()
    expect(await screen.findByRole('link', { name: /返回首页/ })).toHaveAttribute('href', '/')
    await waitFor(() => expect(document.title).toBe('知识库 · Navi'))
  })

  it('加载中显示暖纸色骨架屏（spec §7.1）', () => {
    vi.mocked(fetchOverview).mockReturnValue(new Promise<OverviewResponse>(() => {}))
    const { container } = renderPage()
    expect(container.querySelector('.skeleton')).not.toBeNull()
  })

  it('加载失败时内联错误并可重试（不弹框，spec §7.2）', async () => {
    vi.mocked(fetchOverview).mockRejectedValueOnce(new Error('获取路径总览失败：500'))
    renderPage()
    expect(await screen.findByText('获取路径总览失败：500')).toBeInTheDocument()
    vi.mocked(fetchOverview).mockResolvedValueOnce(overview)
    await userEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(await screen.findByRole('heading', { name: '七条路径' })).toBeInTheDocument()
  })
})

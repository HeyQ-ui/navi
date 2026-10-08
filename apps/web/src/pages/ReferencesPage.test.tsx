import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fetchReferences } from '../api.js'
import type { ReferencesResponse } from '../api.js'
import { ReferencesPage } from './ReferencesPage.js'

vi.mock('../api.js', async () => {
  const actual = await vi.importActual<typeof import('../api.js')>('../api.js')
  return { ...actual, fetchReferences: vi.fn(), fetchMe: vi.fn(), fetchMeta: vi.fn() }
})

const references: ReferencesResponse = {
  blocks: [
    {
      type: 'references',
      html:
        '<table><tr><th>#</th><th>参考文献题录</th><th>来源</th></tr>' +
        '<tr><td>1</td><td>梁伟，李永刚。硕士研究生推荐免试招生提前考核的流程剖析及问题反思。中国考试，2022.</td>' +
        '<td><a href="http://example.com/a">来源</a></td></tr></table>',
      raw: '| 1 | 题录 | [来源](http://example.com/a) |',
    },
  ],
}

function renderPage() {
  return render(<ReferencesPage />)
}

beforeEach(() => {
  window.history.pushState({}, '', '/references')
  vi.mocked(fetchReferences).mockResolvedValue(references)
})

describe('ReferencesPage', () => {
  it('逐行列出参考文献，来源是文字超链接（spec §5.9）', async () => {
    renderPage()
    expect(await screen.findByRole('heading', { name: '参考文献' })).toBeInTheDocument()
    expect(screen.getByText(/硕士研究生推荐免试招生提前考核/)).toBeInTheDocument()
    const link = screen.getByRole('link', { name: '来源' })
    expect(link).toHaveAttribute('href', 'http://example.com/a')
  })

  it('页头有返回七条路径入口（spec §5.9）', async () => {
    renderPage()
    expect(await screen.findByRole('link', { name: /返回七条路径/ })).toHaveAttribute('href', '/paths')
    await waitFor(() => expect(document.title).toBe('参考文献 · Navi'))
  })

  it('加载中显示暖纸色骨架屏（spec §7.1）', () => {
    vi.mocked(fetchReferences).mockReturnValue(new Promise<ReferencesResponse>(() => {}))
    const { container } = renderPage()
    expect(container.querySelector('.skeleton')).not.toBeNull()
  })

  it('加载失败时内联错误并可重试（不弹框，spec §7.2）', async () => {
    vi.mocked(fetchReferences).mockRejectedValueOnce(new Error('获取参考文献失败：500'))
    renderPage()
    expect(await screen.findByText('获取参考文献失败：500')).toBeInTheDocument()
    vi.mocked(fetchReferences).mockResolvedValueOnce(references)
    await userEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(await screen.findByRole('heading', { name: '参考文献' })).toBeInTheDocument()
  })
})

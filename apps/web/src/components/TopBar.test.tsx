import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fetchMe, logout } from '../api.js'
import { FlowProvider } from '../state.js'
import { TopBar } from './TopBar.js'

vi.mock('../api.js', () => ({
  fetchMe: vi.fn(),
  logout: vi.fn(),
  authenticate: vi.fn(),
  fetchMeta: vi.fn(),
}))

function renderBar() {
  return render(<FlowProvider><TopBar /></FlowProvider>)
}

beforeEach(() => {
  vi.mocked(logout).mockResolvedValue(undefined)
})

describe('TopBar', () => {
  it('未登录时右侧只有登录入口', async () => {
    vi.mocked(fetchMe).mockResolvedValue(null)
    renderBar()
    expect(await screen.findByRole('link', { name: '登录' })).toBeInTheDocument()
    expect(screen.queryByText('历史')).not.toBeInTheDocument()
  })

  it('已登录时显示历史入口、账号名与登出', async () => {
    vi.mocked(fetchMe).mockResolvedValue({ id: 'u1', username: 'tester' })
    renderBar()
    expect(await screen.findByText('tester')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '历史' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '登出' })).toBeInTheDocument()
  })

  it('登出失败时留在原地并把错误说出来，不假装已登出', async () => {
    vi.mocked(fetchMe).mockResolvedValue({ id: 'u1', username: 'tester' })
    vi.mocked(logout).mockRejectedValue(new Error('登出失败：500'))
    renderBar()
    await userEvent.click(await screen.findByRole('button', { name: '登出' }))
    expect(await screen.findByText('登出失败：500')).toBeInTheDocument()
    expect(screen.getByText('tester')).toBeInTheDocument()
  })
})

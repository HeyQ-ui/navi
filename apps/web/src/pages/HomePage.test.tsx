import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fetchMe } from '../api.js'
import { FlowProvider, useFlow } from '../state.js'
import { HomePage } from './HomePage.js'

vi.mock('../api.js', async () => {
  const actual = await vi.importActual<typeof import('../api.js')>('../api.js')
  return { ...actual, fetchMe: vi.fn(), authenticate: vi.fn(), logout: vi.fn(), fetchMeta: vi.fn() }
})

/** 会话探测是异步的：点击入口前必须等 authReady，否则登录态判断拿到旧快照 */
function AuthProbe() {
  const { authReady } = useFlow()
  return <span data-testid="auth-ready">{String(authReady)}</span>
}

function renderHome() {
  return render(<FlowProvider><HomePage /><AuthProbe /></FlowProvider>)
}

beforeEach(() => {
  window.history.pushState({}, '', '/')
})

describe('HomePage', () => {
  it('主张、双入口与元信息行（spec §5.1）', async () => {
    vi.mocked(fetchMe).mockResolvedValue(null)
    renderHome()
    expect(await screen.findByText(/先看清自己，再看清/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '测测自己' })).toBeInTheDocument()
    // 次入口是路径总览，不是第二个测评入口
    expect(screen.getByRole('link', { name: '查看七种大学生路径' })).toHaveAttribute('href', '/paths')
    expect(screen.getByRole('button', { name: '临时测试' })).toBeInTheDocument()
    expect(screen.getByText(/测试约5分钟/)).toBeInTheDocument()
  })

  it('次入口「查看七种大学生路径」免登录直达总览（spec §4.2）', async () => {
    vi.mocked(fetchMe).mockResolvedValue(null)
    renderHome()
    await waitFor(() => expect(screen.getByTestId('auth-ready')).toHaveTextContent('true'))
    await userEvent.click(screen.getByRole('link', { name: '查看七种大学生路径' }))
    expect(window.location.pathname).toBe('/paths')
  })

  it('未登录点入口先进登录页（登录门槛，spec §4.2）', async () => {
    vi.mocked(fetchMe).mockResolvedValue(null)
    renderHome()
    await waitFor(() => expect(screen.getByTestId('auth-ready')).toHaveTextContent('true'))
    await userEvent.click(screen.getByRole('button', { name: '测测自己' }))
    expect(window.location.pathname).toBe('/auth')
  })

  it('已登录点入口直接进年级选择', async () => {
    vi.mocked(fetchMe).mockResolvedValue({ id: 'u1', username: 'tester' })
    renderHome()
    await waitFor(() => expect(screen.getByTestId('auth-ready')).toHaveTextContent('true'))
    await userEvent.click(screen.getByRole('button', { name: '临时测试' }))
    expect(window.location.pathname).toBe('/grade')
  })
})

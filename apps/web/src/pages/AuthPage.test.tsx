import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { authenticate, fetchMe } from '../api.js'
import { FlowProvider } from '../state.js'
import { AuthPage } from './AuthPage.js'

vi.mock('../api.js', async () => {
  const actual = await vi.importActual<typeof import('../api.js')>('../api.js')
  return { ...actual, fetchMe: vi.fn(), authenticate: vi.fn(), logout: vi.fn(), fetchMeta: vi.fn() }
})

function renderAuth() {
  return render(<FlowProvider><AuthPage /></FlowProvider>)
}

beforeEach(() => {
  window.history.pushState({}, '', '/auth')
  vi.mocked(fetchMe).mockResolvedValue(null)
})

describe('AuthPage', () => {
  it('字段是「账号」不是邮箱——全站禁现「邮箱」字样（spec 验收 3）', () => {
    renderAuth()
    expect(screen.getByLabelText('账号')).toBeInTheDocument()
    expect(screen.getByLabelText('密码')).toBeInTheDocument()
    expect(screen.queryByText(/邮箱/)).not.toBeInTheDocument()
  })

  it('登录失败时原样显示服务端文案（契约延续）', async () => {
    vi.mocked(authenticate).mockRejectedValue(new Error('账号或密码不正确'))
    renderAuth()
    await userEvent.type(screen.getByLabelText('账号'), 'tester')
    await userEvent.type(screen.getByLabelText('密码'), 'wrong')
    await userEvent.click(screen.getByRole('button', { name: '登录' }))
    expect(await screen.findByText('账号或密码不正确')).toBeInTheDocument()
  })

  it('503 的服务端文案同样原样显示——它是排查线索，不能泛化（契约延续）', async () => {
    vi.mocked(authenticate).mockRejectedValue(new Error('账号功能暂不可用：服务端未配置会话密钥'))
    renderAuth()
    await userEvent.type(screen.getByLabelText('账号'), 'tester')
    await userEvent.type(screen.getByLabelText('密码'), 'x')
    await userEvent.click(screen.getByRole('button', { name: '登录' }))
    expect(await screen.findByText('账号功能暂不可用：服务端未配置会话密钥')).toBeInTheDocument()
  })

  it('登录成功后跳回回跳点', async () => {
    vi.mocked(authenticate).mockResolvedValue({ id: 'u1', username: 'tester' })
    renderAuth()
    await userEvent.type(screen.getByLabelText('账号'), 'tester')
    await userEvent.type(screen.getByLabelText('密码'), 'secret')
    await userEvent.click(screen.getByRole('button', { name: '登录' }))
    await waitFor(() => expect(window.location.pathname).toBe('/'))
  })

  it('登录与注册同页切换', async () => {
    renderAuth()
    await userEvent.click(screen.getByRole('button', { name: '还没有账号？注册' }))
    expect(screen.getByRole('heading', { name: '注册' })).toBeInTheDocument()
  })
})

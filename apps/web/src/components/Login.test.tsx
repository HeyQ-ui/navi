import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Login } from './Login.js'

beforeEach(() => { vi.restoreAllMocks() })

describe('Login', () => {
  it('默认是登录态，可切到注册', async () => {
    render(<Login onSuccess={() => {}} />)
    expect(screen.getByRole('button', { name: '登录' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '还没有账号？注册' }))
    expect(screen.getByRole('button', { name: '注册' })).toBeInTheDocument()
  })

  it('登录成功后回调带上用户名', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ id: 'u1', username: 'alice' }), { status: 200 }),
    )
    const onSuccess = vi.fn()
    render(<Login onSuccess={onSuccess} />)

    await userEvent.type(screen.getByLabelText('用户名'), 'alice')
    await userEvent.type(screen.getByLabelText('密码'), 'pw123456')
    await userEvent.click(screen.getByRole('button', { name: '登录' }))

    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith('alice'))
  })

  it('登录失败时显示服务端返回的错误文案，不回调', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: '用户名或密码不正确' }), { status: 401 }),
    )
    const onSuccess = vi.fn()
    render(<Login onSuccess={onSuccess} />)

    await userEvent.type(screen.getByLabelText('用户名'), 'alice')
    await userEvent.type(screen.getByLabelText('密码'), 'wrong')
    await userEvent.click(screen.getByRole('button', { name: '登录' }))

    expect(await screen.findByText('用户名或密码不正确')).toBeInTheDocument()
    expect(onSuccess).not.toHaveBeenCalled()
  })
})

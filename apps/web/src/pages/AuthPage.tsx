import { useState } from 'react'
import type { FormEvent } from 'react'
import { useLocation } from 'wouter'
import { useFlow } from '../state.js'
import { useTitle } from '../lib/use-title.js'

/** 登录 / 注册同页切换。字段是「账号」——全站不得出现「邮箱」字样（spec 验收 3） */
export function AuthPage() {
  useTitle('登录 · Navi')
  const flow = useFlow()
  const [, navigate] = useLocation()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await flow.signIn(mode, username, password)
      const to = flow.authRedirect ?? '/'
      flow.setAuthRedirect(null)
      navigate(to)
    } catch (e) {
      // 服务端文案原样显示：503 时它说的是「未配置会话密钥」，改写会误导排查
      setError(e instanceof Error ? e.message : '操作失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-[380px] animate-rise px-6 py-20">
      <h1 className="font-serif text-[28px] font-black">{mode === 'login' ? '登录' : '注册'}</h1>
      <p className="mt-2 text-[14px] text-ink-2">
        {mode === 'login' ? '接着上次的进度。' : '创建一个账号，测评与对话都会留存。'}
      </p>

      <form onSubmit={submit} className="mt-8 space-y-4">
        <div>
          <label htmlFor="username" className="mb-1.5 block text-[14px]">账号</label>
          <input
            id="username" name="username" className="field-input" autoComplete="username"
            value={username} onChange={e => setUsername(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="password" className="mb-1.5 block text-[14px]">密码</label>
          <input
            id="password" name="password" type="password" className="field-input"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            value={password} onChange={e => setPassword(e.target.value)}
          />
        </div>
        {error !== '' && <p className="text-[13px] text-bad">{error}</p>}
        <button type="submit" className="btn-primary w-full" disabled={busy}>
          {busy && <span className="spinner" />}
          {mode === 'login' ? '登录' : '注册'}
        </button>
      </form>

      <button
        type="button"
        className="mt-5 text-[13px] text-ink-2 underline underline-offset-4 hover:text-accent-deep"
        onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError('') }}
      >
        {mode === 'login' ? '还没有账号？注册' : '已有账号？登录'}
      </button>
    </div>
  )
}

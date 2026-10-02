import { useState } from 'react'
import type { FormEvent } from 'react'
import { authenticate } from '../api.js'

interface Props {
  onSuccess: (username: string) => void
}

/** 注册与登录共用一个表单：字段一样，只是提交的端点与按钮文案不同 */
export function Login({ onSuccess }: Props) {
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
      const account = await authenticate(mode, username, password)
      onSuccess(account.username)
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-sm p-6">
      <h1 className="mb-4 text-xl font-semibold">Navi</h1>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label htmlFor="username" className="block text-sm">用户名</label>
          <input
            id="username" name="username" value={username}
            onChange={e => setUsername(e.target.value)}
            className="w-full border p-2" autoComplete="username"
          />
        </div>
        <div>
          <label htmlFor="password" className="block text-sm">密码</label>
          <input
            id="password" name="password" type="password" value={password}
            onChange={e => setPassword(e.target.value)}
            className="w-full border p-2" autoComplete="current-password"
          />
        </div>
        {error !== '' && <p className="text-red-600">{error}</p>}
        <button type="submit" disabled={busy} className="w-full border px-4 py-2">
          {mode === 'login' ? '登录' : '注册'}
        </button>
      </form>
      <button
        type="button"
        className="mt-3 text-sm text-gray-600 underline"
        onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError('') }}
      >
        {mode === 'login' ? '还没有账号？注册' : '已有账号？登录'}
      </button>
    </div>
  )
}

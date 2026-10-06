import { useState } from 'react'
import { Link, useLocation } from 'wouter'
import { useFlow } from '../state.js'

export function TopBar() {
  const flow = useFlow()
  const [, navigate] = useLocation()
  const [error, setError] = useState('')

  async function signOut() {
    setError('')
    try {
      await flow.signOut()
      navigate('/')
    } catch (e) {
      setError(e instanceof Error ? e.message : '登出失败，请重试')
    }
  }

  return (
    <header className="sticky top-0 z-10 border-b border-line bg-paper/95 backdrop-blur">
      <div className="mx-auto flex max-w-prose items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-baseline gap-2">
          <span className="font-serif text-[22px] font-black">Navi</span>
          <span className="text-[13px] text-ink-2">大学生生涯规划</span>
        </Link>
        <nav className="flex items-center gap-5 text-[14px]">
          {flow.account !== null ? (
            <>
              <Link href="/history" className="text-ink-2 transition-colors hover:text-accent-deep">历史</Link>
              <span className="text-ink-2">{flow.account.username}</span>
              <button
                type="button"
                className="text-ink-2 transition-colors hover:text-accent-deep"
                onClick={() => void signOut()}
              >
                登出
              </button>
            </>
          ) : (
            <Link href="/auth" className="text-accent-deep">登录</Link>
          )}
        </nav>
      </div>
      {error !== '' && (
        <p className="mx-auto max-w-prose px-6 pb-2 text-[13px] text-bad">{error}</p>
      )}
    </header>
  )
}

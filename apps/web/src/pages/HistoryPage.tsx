import { useEffect, useState } from 'react'
import { Link, Redirect } from 'wouter'
import { fetchAssessments } from '../api.js'
import type { AssessmentSummary } from '../api.js'
import { useTitle } from '../lib/use-title.js'
import { useFlow } from '../state.js'

const SOURCE_LABELS: Record<string, string> = { self: '测测自己', other: '测测别人' }

// 与 GradePage 的 GRADE_OPTIONS 同一份文案；只在这一行元信息里用，不抽共享模块
const GRADE_LABELS: Record<string, string> = {
  freshman: '大一', sophomore: '大二', junior: '大三', senior: '大四及以上',
}

/** 元信息行：来源 · 年级 · 画像名，缺谁省略谁（spec §5.7） */
function metaOf(row: AssessmentSummary): string {
  const grade = row.grade === null ? undefined : GRADE_LABELS[row.grade]
  // typeof 判定一并剔掉 undefined 与 null（archetypeName 为 null）：否则 join 会留下
  // 一个悬空的「 · 」，与「缺谁省略谁」相悖
  return [SOURCE_LABELS[row.source], grade, row.archetypeName]
    .filter((part): part is string => typeof part === 'string' && part !== '')
    .join(' · ')
}

export function HistoryPage() {
  useTitle('历史 · Navi')
  const { authReady, account, setAuthRedirect } = useFlow()
  const [rows, setRows] = useState<AssessmentSummary[] | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)

  const loggedIn = authReady && account !== null

  useEffect(() => {
    // 未登录会被送去 /auth；先记下回跳点，登录成功后回历史页而不是首页
    if (authReady && account === null) setAuthRedirect('/history')
  }, [authReady, account, setAuthRedirect])

  useEffect(() => {
    if (!loggedIn) return
    let cancelled = false
    setLoading(true)
    setError('')
    void fetchAssessments()
      .then(list => { if (!cancelled) setRows(list) })
      .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : '加载失败') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [loggedIn, reloadKey])

  // 会话探测是异步的：登录态确认前不跳转，先给骨架，否则会把已登录用户误送去 /auth
  if (!authReady) {
    return (
      <div className="mx-auto max-w-prose px-6 py-14">
        <div className="skeleton h-9 w-40" />
        <div className="mt-3 skeleton h-4 w-64" />
        <div className="mt-10 skeleton h-16 w-full rounded-panel" />
        <div className="mt-3 skeleton h-16 w-full rounded-panel" />
      </div>
    )
  }

  if (account === null) return <Redirect to="/auth" />

  return (
    <div className="mx-auto max-w-prose animate-rise px-6 py-14">
      <header>
        <h1 className="font-serif text-[34px] font-black leading-[1.3]">你的历史</h1>
        <p className="mt-2 text-[14px] text-ink-2">每一次测评都留在这里，随时回看。</p>
      </header>

      {loading ? (
        <ul className="mt-8 space-y-2.5">
          {[0, 1, 2].map(i => (
            <li key={i} className="flex items-center gap-5 rounded-lg border border-line bg-surface px-5 py-4">
              <span className="skeleton h-10 w-14 shrink-0" />
              <span className="flex-1 space-y-2">
                <span className="skeleton block h-4 w-40" />
                <span className="skeleton block h-3 w-56" />
              </span>
              <span className="skeleton h-5 w-8 shrink-0" />
            </li>
          ))}
        </ul>
      ) : error !== '' ? (
        <div className="mt-8 rounded-panel border border-line bg-surface p-8 text-center">
          <p className="text-[15px]">{error}</p>
          <button type="button" className="btn-primary mt-5" onClick={() => setReloadKey(k => k + 1)}>
            重试
          </button>
        </div>
      ) : rows !== null && rows.length === 0 ? (
        <div className="mt-8 rounded-panel border border-line bg-surface p-10 text-center">
          <p className="font-serif text-[19px] font-black">还没有记录</p>
          <Link href="/" className="btn-primary mt-5 inline-block">做一次测评</Link>
        </div>
      ) : (
        <ul className="mt-8 space-y-2.5">
          {(rows ?? []).map(row => {
            const d = new Date(row.createdAt)
            return (
              <li key={row.id}>
                <Link
                  href={`/history/${row.id}`}
                  className="group flex items-center gap-5 rounded-lg border border-line bg-surface px-5 py-4 transition-all hover:-translate-y-px hover:border-accent"
                >
                  <span className="w-14 shrink-0 text-center">
                    <span className="font-num block text-[26px] font-semibold leading-none">
                      {d.getDate()}
                    </span>
                    <span className="mt-1 block text-[12px] text-ink-3">
                      {d.getFullYear()} · {d.getMonth() + 1}
                    </span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-medium transition-colors group-hover:text-accent-deep">
                      {row.mainPathTitle ?? '无主推荐'}
                    </span>
                    <span className="mt-0.5 block truncate text-[13px] text-ink-3">{metaOf(row)}</span>
                  </span>
                  {row.match !== null && (
                    <span className="font-num shrink-0 text-[17px] font-semibold text-accent">
                      {Math.round(row.match)}
                    </span>
                  )}
                  <span className="text-ink-3 transition-colors group-hover:text-accent">›</span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

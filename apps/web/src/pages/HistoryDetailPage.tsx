import { useEffect, useState } from 'react'
import { Link, Redirect } from 'wouter'
import { fetchAssessment } from '../api.js'
import type { AssessmentDetail } from '../api.js'
import { ResultBody } from '../components/ResultBody.js'
import { useTitle } from '../lib/use-title.js'
import { useFlow } from '../state.js'

const SOURCE_LABELS: Record<string, string> = { self: '测测自己', other: '测测别人' }

function formatDate(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
}

function PageSkeleton() {
  return (
    <div className="mx-auto max-w-prose px-6 py-14">
      <div className="skeleton h-4 w-24" />
      <div className="mt-6 skeleton h-9 w-64" />
      <div className="mt-4 skeleton h-4 w-full" />
      <div className="mt-3 skeleton h-4 w-5/6" />
      <div className="mt-10 skeleton h-44 w-full rounded-panel" />
    </div>
  )
}

/** 历史详情 = 结果页视图 + 记录快照（spec §5.7）：数据形状一致，一次请求取全 */
export function HistoryDetailPage({ recordId }: { recordId: string }) {
  useTitle('测评记录 · Navi')
  const { authReady, account, setAuthRedirect } = useFlow()
  const [detail, setDetail] = useState<AssessmentDetail | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)

  const loggedIn = authReady && account !== null

  useEffect(() => {
    // 未登录会被送去 /auth；记下回跳点，登录成功后回到正在看的这条记录
    if (authReady && account === null) setAuthRedirect(`/history/${recordId}`)
  }, [authReady, account, recordId, setAuthRedirect])

  useEffect(() => {
    if (!loggedIn) return
    let cancelled = false
    setLoading(true)
    setError('')
    void fetchAssessment(recordId)
      .then(d => { if (!cancelled) setDetail(d) })
      .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : '加载失败') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [recordId, loggedIn, reloadKey])

  if (!authReady) return <PageSkeleton />

  if (account === null) return <Redirect to="/auth" />

  if (loading) return <PageSkeleton />

  if (error !== '' || detail === null) {
    return (
      <div className="mx-auto max-w-prose animate-rise px-6 py-20 text-center">
        <h1 className="font-serif text-[24px] font-black">这条记录暂时打不开</h1>
        {error !== '' && <p className="mt-3 text-[14px] text-ink-2">{error}</p>}
        <div className="mt-6 flex justify-center gap-3">
          <button type="button" className="btn-primary" onClick={() => setReloadKey(k => k + 1)}>
            重试
          </button>
          <Link href="/history" className="btn-secondary">← 回到历史</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-prose animate-rise px-6 py-14">
      <Link href="/history" className="text-[14px] text-ink-2 transition-colors hover:text-accent-deep">
        ← 回到历史
      </Link>
      <header className="mb-12 mt-6">
        <p className="font-num text-[13px] font-medium tracking-wide text-ink-3">
          {formatDate(detail.createdAt)} · {SOURCE_LABELS[detail.source]}
        </p>
        <h1 className="mt-1 font-serif text-[34px] font-black leading-[1.3]">测评记录</h1>
      </header>
      <ResultBody
        result={detail.result}
        paths={detail.paths}
        tiedPaths={detail.tiedPaths}
        assessmentId={detail.id}
        interpretation={detail.interpretation}
      />
    </div>
  )
}

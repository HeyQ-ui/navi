import { useEffect, useState } from 'react'
import { Link } from 'wouter'
import { fetchPathKnowledge } from '../api.js'
import type { PathKnowledge } from '../api.js'
import { BlockRenderer } from '../components/BlockRenderer.js'
import { StatusBadge } from '../components/StatusBadge.js'
import { useTitle } from '../lib/use-title.js'
import { useFlow } from '../state.js'

/** 路径详情：免登录可直达（spec §4.1）；匹配分只在有结果上下文时显示（§5.6） */
export function PathDetailPage({ pathId }: { pathId: string }) {
  const flow = useFlow()
  const [knowledge, setKnowledge] = useState<PathKnowledge | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    void fetchPathKnowledge(pathId)
      .then(k => { if (!cancelled) setKnowledge(k) })
      .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : '加载失败') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [pathId, reloadKey])

  // 浏览器标题 =「{路径名}-详情」（spec §4.1）；数据未到前先给通用标题
  useTitle(knowledge === null ? '路径详情 · Navi' : `${knowledge.path.title}-详情`)

  const backTo = flow.result !== null ? '/result' : '/'
  const backLabel = flow.result !== null ? '回到结果' : '回到首页'
  const match = flow.result?.paths.find(p => p.id === pathId)

  if (loading) {
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

  if (error !== '' || knowledge === null) {
    return (
      <div className="mx-auto max-w-prose animate-rise px-6 py-20 text-center">
        <h1 className="font-serif text-[24px] font-black">这条路径暂时打不开</h1>
        {error !== '' && <p className="mt-3 text-[14px] text-ink-2">{error}</p>}
        <div className="mt-6 flex justify-center gap-3">
          <button type="button" className="btn-primary" onClick={() => setReloadKey(k => k + 1)}>
            重试
          </button>
          <Link href={backTo} className="btn-secondary">← {backLabel}</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-prose animate-rise px-6 py-14">
      <Link href={backTo} className="text-[14px] text-ink-2 transition-colors hover:text-accent-deep">
        ← {backLabel}
      </Link>
      <header className="mt-6">
        <div className="flex items-baseline gap-3">
          <h1 className="font-serif text-[34px] font-black leading-[1.3]">{knowledge.path.title}</h1>
          <StatusBadge status={knowledge.path.status} />
        </div>
        {match !== undefined && (
          <p className="mt-3">
            <span className="font-num text-[28px] font-semibold leading-none text-accent">
              {Math.round(match.match)}
            </span>
            <span className="ml-2 text-[13px] text-ink-3">匹配分</span>
          </p>
        )}
      </header>
      {knowledge.path.summary !== '' && (
        <p className="mt-6 text-[16px] text-ink-2">{knowledge.path.summary}</p>
      )}
      <div className="mt-10">
        <BlockRenderer blocks={knowledge.blocks} grade={flow.grade} />
      </div>
    </div>
  )
}

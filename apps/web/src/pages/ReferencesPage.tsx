import { useEffect, useState } from 'react'
import { Link } from 'wouter'
import { fetchReferences } from '../api.js'
import type { ReferencesResponse } from '../api.js'
import { BlockRenderer } from '../components/BlockRenderer.js'
import { useTitle } from '../lib/use-title.js'

/**
 * 参考文献 `/references`：知识库全部条目的来源清单（前端重设计 spec §5.9）。
 * 入口是七条路径页页尾的小字链接，同样是浏览不挡的免登录页面。
 * 与 /api/knowledge/:pathId 同构返回块数组，因此复用同一个 BlockRenderer。
 */
export function ReferencesPage() {
  useTitle('参考文献 · Navi')
  const [data, setData] = useState<ReferencesResponse | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    void fetchReferences()
      .then(d => { if (!cancelled) setData(d) })
      .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : '加载失败') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [reloadKey])

  if (loading) {
    return (
      <div className="mx-auto max-w-prose px-6 py-14">
        <div className="skeleton h-9 w-48" />
        <div className="mt-3 skeleton h-4 w-72" />
        <div className="mt-12 skeleton h-64 w-full rounded-lg" />
      </div>
    )
  }

  if (error !== '' || data === null) {
    return (
      <div className="mx-auto max-w-prose animate-rise px-6 py-20 text-center">
        <h1 className="font-serif text-[24px] font-black">这会儿打不开参考文献</h1>
        {error !== '' && <p className="mt-3 text-[14px] text-ink-2">{error}</p>}
        <button
          type="button"
          className="btn-primary mt-6"
          onClick={() => setReloadKey(k => k + 1)}
        >
          重试
        </button>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-prose animate-rise px-6 py-14">
      <header>
        <Link href="/paths" className="text-[14px] text-ink-2 transition-colors hover:text-accent-deep">
          ← 返回七条路径
        </Link>
        <h1 className="mt-6 font-serif text-[34px] font-black leading-[1.3]">参考文献</h1>
        <p className="mt-3 text-[15px] text-ink-2">
          七条路径的知识均取自下列来源，逐条可查。
        </p>
      </header>

      <div className="mt-10">
        <BlockRenderer blocks={data.blocks} grade={null} />
      </div>
    </div>
  )
}

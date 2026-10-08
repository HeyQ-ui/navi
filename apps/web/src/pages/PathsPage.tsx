import { useEffect, useState } from 'react'
import { Link } from 'wouter'
import { fetchOverview } from '../api.js'
import type { OverviewResponse } from '../api.js'
import { BlockRenderer } from '../components/BlockRenderer.js'
import { PathRow } from '../components/PathRow.js'
import { useTitle } from '../lib/use-title.js'

/**
 * 路径总览 `/paths`：不做诊断直接浏览知识库的入口（主文档 §9.1）。
 * 数据一次取齐（spec §8.4）——路径摘要 + common.md 的通用知识块。
 */
export function PathsPage() {
  useTitle('知识库 · Navi')
  const [data, setData] = useState<OverviewResponse | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    void fetchOverview()
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
        <div className="mt-12 space-y-2.5">
          {[0, 1, 2, 3, 4, 5, 6].map(i => (
            <div key={i} className="skeleton h-12 w-full rounded-lg" />
          ))}
        </div>
      </div>
    )
  }

  if (error !== '' || data === null) {
    return (
      <div className="mx-auto max-w-prose animate-rise px-6 py-20 text-center">
        <h1 className="font-serif text-[24px] font-black">这会儿打不开路径总览</h1>
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

  // 误区与其余块分开呈现，但都不做类型白名单：除 myth 之外的一律进第 03 节，
  // 将来 common.md 用了新块类型也不会在这一页被丢掉（硬性约束 3）
  const myths = data.common.filter(block => block.type === 'myth')
  const rest = data.common.filter(block => block.type !== 'myth')

  return (
    <div className="mx-auto max-w-prose animate-rise px-6 py-14">
      <header>
        <Link href="/" className="text-[14px] text-ink-2 transition-colors hover:text-accent-deep">
          ← 返回首页
        </Link>
        <h1 className="mt-6 font-serif text-[34px] font-black leading-[1.3]">Navi的知识库</h1>
        <p className="mt-3 text-[15px] text-ink-2">
          了解Navi的知识库和参考文献
        </p>
      </header>

      <section className="mt-12">
        <div className="section-head">
          <span className="section-num">01</span>
          <h2 className="section-title">七条路径</h2>
        </div>
        <ul className="space-y-2.5">
          {data.paths.map(path => (
            <PathRow
              key={path.id}
              data={{ id: path.id, title: path.title, status: path.status, from: 'paths' }}
            />
          ))}
        </ul>
      </section>

      {myths.length > 0 && (
        <section className="mt-14">
          <div className="section-head">
            <span className="section-num">02</span>
            <h2 className="section-title">大一新生常见误区</h2>
          </div>
          <BlockRenderer blocks={myths} grade={null} />
        </section>
      )}

      {rest.length > 0 && (
        <section className="mt-14">
          <div className="section-head">
            <span className="section-num">03</span>
            <h2 className="section-title">七条路径横向对比</h2>
          </div>
          <BlockRenderer blocks={rest} grade={null} />
        </section>
      )}

      {/* 页尾小字：知识库的来源清单入口（spec §5.8 / §5.9） */}
      <footer className="mt-16 border-t border-line pt-6 text-[13px] text-ink-3">
        <Link href="/references" className="transition-colors hover:text-accent-deep">
          查看参考文献
        </Link>
      </footer>
    </div>
  )
}

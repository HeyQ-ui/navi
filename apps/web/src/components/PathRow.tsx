import { Link } from 'wouter'
import type { EligibilityFailure } from '../api.js'
import { StatusBadge } from './StatusBadge.js'

export interface PathRowData {
  id: string
  title: string
  status: string
  /**
   * 匹配分与适用性只有测评上下文才有（结果页）。
   * 路径总览页不做诊断直接浏览，这两项缺席——此时不渲染匹配条与分数，
   * 而不是拿 0 分或空条充数（spec §5.1「没有数据支撑的数字，一个都不写给你看」）。
   */
  match?: number
  applicable?: boolean
  hardFailures?: EligibilityFailure[]
  /**
   * 来源页标记：只有路径总览页传 'paths'。详情页据此把返回链指回来处（spec §5.6），
   * 结果页不传，href 保持干净的 `/path/:id`。
   */
  from?: string
}

/**
 * 一条路径的入口行。渲染 `<li>`，由调用方放进 `<ul>`。
 * 结果页与路径总览页共用（spec §5.5 02 段 / §5.8 01 节）。
 */
export function PathRow({ data }: { data: PathRowData }) {
  const applicable = data.applicable ?? true
  const match = data.match
  const hardFailures = data.hardFailures ?? []
  const href = data.from === undefined
    ? `/path/${data.id}`
    : `/path/${data.id}?from=${encodeURIComponent(data.from)}`

  return (
    <li>
      <Link
        href={href}
        className={`group flex items-center gap-4 rounded-lg border border-line bg-surface px-5 py-3.5 transition-all hover:-translate-y-px hover:border-accent ${
          applicable ? '' : 'opacity-55'
        }`}
      >
        <span className="w-40 shrink-0 text-[15px] group-hover:text-accent-deep">{data.title}</span>
        <StatusBadge status={data.status} />
        {match !== undefined ? (
          <>
            <span className="h-1 flex-1 overflow-hidden rounded bg-line">
              <span
                className={`block h-1 ${applicable ? 'bg-ink-3' : 'bg-ink-3/50'}`}
                style={{ width: `${Math.round(match)}%` }}
              />
            </span>
            <span className="font-num w-8 text-right text-[15px]">{Math.round(match)}</span>
          </>
        ) : (
          // 浏览态没有分数，用弹性空白把 › 顶到行尾，保持与结果页同一版式
          <span className="flex-1" />
        )}
        <span className="text-ink-3 transition-colors group-hover:text-accent">›</span>
      </Link>
      {!applicable && hardFailures.length > 0 && (
        <ul className="mt-1 pl-5 text-[12px] text-ink-3">
          {hardFailures.map(f => <li key={f.id}>不适用：{f.message}</li>)}
        </ul>
      )}
    </li>
  )
}

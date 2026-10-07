import { useEffect, useState } from 'react'
import { Link } from 'wouter'
import type { DiagnosisResult, PathSummary } from '../api.js'
import { fetchPathKnowledge } from '../api.js'
import type { PathKnowledge } from '../api.js'
import { gapRows, mainPathOf, radarRows } from '../lib/result-math.js'
import { useMeta } from '../state.js'
import { InterpretSection } from './InterpretSection.js'
import { PathRow } from './PathRow.js'
import { ProfileRadar } from './ProfileRadar.js'
import { Reveal } from './Reveal.js'
import { StatusBadge } from './StatusBadge.js'

interface Props {
  result: DiagnosisResult
  paths: PathSummary[]
  tiedPaths: string[]
  assessmentId: string
  /** 历史详情带回来的解读；刚测完为 null，由 InterpretSection 现场生成 */
  interpretation: string | null
}

/** 结果页四段叙事；/result 与 /history/:recordId 共用（数据形状一致） */
export function ResultBody({ result, paths, tiedPaths, assessmentId, interpretation }: Props) {
  const pathById = new Map(paths.map(p => [p.id, p]))
  const main = mainPathOf(result)
  const others = result.paths.filter(p => p.id !== main?.id)
  const { meta } = useMeta()

  const [knowledge, setKnowledge] = useState<PathKnowledge | null>(null)
  useEffect(() => {
    if (main === null) return
    let cancelled = false
    void fetchPathKnowledge(main.id)
      .then(k => { if (!cancelled) setKnowledge(k) })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [main?.id])

  const indicators = meta?.indicators ?? []
  const primary = result.archetypes[0]
  const secondary = result.archetypes[1]
  const primaryDef = meta?.archetypes.find(a => a.id === primary?.id)
  const secondaryDef = meta?.archetypes.find(a => a.id === secondary?.id)

  return (
    <div className="space-y-16">
      {/* 01 你的画像 */}
      <Reveal>
        <section>
          <div className="section-head">
            <span className="section-num">01</span>
            <h2 className="section-title">你的画像</h2>
          </div>
          {/* 雷达在左、叙事在右；雷达那栏给宽一些，否则左右极点的轴标签会被容器裁掉 */}
          <div className="grid grid-cols-[minmax(0,6fr)_minmax(0,5fr)] items-center gap-10">
            <ProfileRadar rows={radarRows(result, indicators)} />
            <div>
              {primaryDef !== undefined && primary !== undefined ? (
                <>
                  <div className="flex items-baseline gap-4">
                    <h3 className="font-serif text-[28px] font-black">{primaryDef.name}</h3>
                    <span className="font-num text-[26px] font-semibold text-accent">
                      {Math.round(primary.affinity * 100)}%
                    </span>
                  </div>
                  <p className="mt-2 text-[15px] text-ink-2">{primaryDef.narrative.oneLiner}</p>
                  <div className="mt-4 grid grid-cols-2 gap-6 text-[14px]">
                    <div>
                      <p className="mb-1 text-[13px] text-ink-3">优势</p>
                      <ul className="space-y-1">
                        {primaryDef.narrative.strengths.map(s => <li key={s}>{s}</li>)}
                      </ul>
                    </div>
                    <div>
                      <p className="mb-1 text-[13px] text-ink-3">盲点</p>
                      <ul className="space-y-1">
                        {primaryDef.narrative.blindspots.map(s => <li key={s}>{s}</li>)}
                      </ul>
                    </div>
                  </div>
                  {secondary !== undefined && secondaryDef !== undefined && (
                    <p className="mt-4 text-[13px] text-ink-3">
                      次要倾向：{secondaryDef.name} · {Math.round(secondary.affinity * 100)}%
                    </p>
                  )}
                </>
              ) : (
                <p className="text-[14px] text-ink-3">画像信息整理中……</p>
              )}
            </div>
          </div>
        </section>
      </Reveal>

      {/* 02 主推荐路径 */}
      <Reveal>
        <section>
          <div className="section-head">
            <span className="section-num">02</span>
            <h2 className="section-title">主推荐路径</h2>
          </div>

          {main === null ? (
            <div className="panel p-8 text-center">
              <h3 className="font-serif text-[22px] font-black">这一次，没有足够适配的路径</h3>
              <p className="mx-auto mt-3 max-w-[460px] text-[14px] text-ink-2">
                每条路径都有不成立的前置条件，原因逐条列在下方。先解决这些前置条件，再回来评估——这本身就是有用的信息。
              </p>
              <div className="mt-6 flex justify-center gap-3">
                <a href="#path-list" className="btn-secondary">查看路径列表</a>
                <Link href="/" className="btn-primary">重新测评</Link>
              </div>
            </div>
          ) : (
            <div className="panel border-accent/40 p-8">
              <div className="flex items-baseline justify-between">
                <h3 className="font-serif text-[24px] font-black">
                  {pathById.get(main.id)?.title ?? main.id}
                </h3>
                <StatusBadge status={pathById.get(main.id)?.status ?? 'verified'} />
              </div>
              <p className="mt-2 text-[15px] text-ink-2">{pathById.get(main.id)?.summary}</p>
              <div className="mt-5 flex items-end justify-between">
                <p>
                  <span className="font-num text-[40px] font-semibold leading-none text-accent">
                    {Math.round(main.match)}
                  </span>
                  <span className="ml-2 text-[13px] text-ink-3">匹配分</span>
                </p>
                <Link href={`/path/${main.id}`} className="btn-primary">查看完整真相 →</Link>
              </div>
              {main.eligibility.softWarnings.length > 0 && (
                <ul className="mt-4 space-y-1 text-[13px] text-warn">
                  {main.eligibility.softWarnings.map(f => <li key={f.id}>注意：{f.message}</li>)}
                </ul>
              )}
              {tiedPaths.length > 1 && (
                <p className="mt-4 border-t border-line pt-3 text-[13px] text-ink-2">
                  {tiedPaths.map(id => pathById.get(id)?.title ?? id).join(' 与 ')}
                  对你的分数相同，差异主要在于各自的代价与时间线，而不是谁更合适。
                </p>
              )}
            </div>
          )}

          {others.length > 0 && (
            <ul id="path-list" className="mt-5 space-y-2.5">
              {others.map(path => {
                const summary = pathById.get(path.id)
                return (
                  <PathRow
                    key={path.id}
                    data={{
                      id: path.id,
                      title: summary?.title ?? path.id,
                      status: summary?.status ?? 'verified',
                      match: path.match,
                      applicable: path.eligibility.applicable,
                      hardFailures: path.eligibility.hardFailures,
                    }}
                  />
                )
              })}
            </ul>
          )}
        </section>
      </Reveal>

      {/* 03 你和这条路 */}
      {main !== null && knowledge !== null && (
        <Reveal>
          <section>
            <div className="section-head">
              <span className="section-num">03</span>
              <h2 className="section-title">你和这条路</h2>
            </div>
            <div className="grid grid-cols-[minmax(0,5fr)_minmax(0,6fr)] items-center gap-10">
              <ProfileRadar
                rows={radarRows(result, indicators, id =>
                  knowledge.path.weights.find(w => w.indicator === id)?.ideal)}
              />
              <div>
                <p className="mb-4 text-[13px] text-ink-3">
                  差距大的地方不是短板，是接下来值得提前补课的方向。
                </p>
                <ul className="space-y-4">
                  {gapRows(result, indicators, knowledge.path.weights).map(row => (
                    <li key={row.id}>
                      <div className="mb-1 flex items-baseline justify-between text-[14px]">
                        <span>{row.name}</span>
                        <span className="font-num text-[13px] text-ink-2">
                          {/* 指标分是加权平均，原始值可能是 16.666…：显示保留 1 位小数 */}
                          你 {Math.round(row.score * 10) / 10} · 理想 {row.ideal}
                        </span>
                      </div>
                      <div className="relative h-2 rounded bg-line/60">
                        <div
                          className="absolute inset-y-0 left-0 rounded bg-accent/80"
                          style={{ width: `${row.score}%` }}
                        />
                        <div
                          className="absolute -inset-y-0.5 w-[2px] bg-ink"
                          style={{ left: `${row.ideal}%` }}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </section>
        </Reveal>
      )}

      {/* 04 个性化解读：锚在主推荐路径上；无可适用路径时整块不挂载 */}
      {main !== null && (
        <Reveal>
          <InterpretSection
            key={main.id}
            assessmentId={assessmentId}
            pathId={main.id}
            interpretation={interpretation}
          />
        </Reveal>
      )}
    </div>
  )
}

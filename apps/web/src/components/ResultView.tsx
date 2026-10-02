import type { DiagnosisResult, PathSummary } from '../api.js'
import { PathAssistant } from './PathAssistant.js'

interface Props {
  result: DiagnosisResult
  paths: PathSummary[]
  /** 与主推荐路径显示分相同的路径 id，含主推荐自身（设计文档 §9.3） */
  tiedPaths?: string[]
  /** 这条结果对应的记录 id——解读与追问现在都锚在记录上，不再重新提交答案 */
  assessmentId: string
  /** 历史详情带回来的解读；刚测完时为 undefined，由 PathAssistant 现场生成 */
  interpretation?: string | null
}

export function ResultView({
  result, paths, tiedPaths = [], assessmentId, interpretation,
}: Props) {
  const pathById = new Map(paths.map(p => [p.id, p]))
  // result.paths 已按匹配度降序（core 的 diagnose 保证），取第一条可适用的即最高分可适用路径
  const main = result.paths.find(p => p.eligibility.applicable) ?? null
  const others = result.paths.filter(p => p.id !== main?.id)
  const inapplicableCount = others.filter(p => !p.eligibility.applicable).length

  return (
    <div className="mx-auto max-w-3xl p-6">
      <section className="mb-8">
        <h2 className="mb-2 text-lg font-semibold">你的画像</h2>
        {result.archetypes.length === 0 ? (
          <p className="text-gray-500">暂无画像信息</p>
        ) : (
          <ul>
            {result.archetypes.slice(0, 2).map(a => (
              <li key={a.id}>
                {a.id} —— {Math.round(a.affinity * 100)}%
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-lg font-semibold">主推荐路径</h2>

        {main === null ? (
          <p className="mb-3 text-sm text-red-600">
            当前没有匹配的路径——下面每一条对你都不成立，原因逐条列出。
            这本身就是有用的信息：先解决这些前置条件，再回来评估。
          </p>
        ) : (
          <div className="border p-4">
            <div className="flex items-baseline justify-between">
              <h3 className="font-medium">{pathById.get(main.id)?.title ?? main.id}</h3>
              {pathById.get(main.id)?.status === 'draft' && (
                <span className="text-xs text-amber-600">待核实</span>
              )}
            </div>

            <p className="mt-1 text-sm text-gray-600">匹配度 {Math.round(main.match)}</p>

            {main.eligibility.softWarnings.length > 0 && (
              <ul className="mt-2 text-sm text-amber-600">
                {main.eligibility.softWarnings.map(f => (
                  <li key={f.id}>注意：{f.message}</li>
                ))}
              </ul>
            )}

            {tiedPaths.length > 1 && (
              <p className="mt-3 text-sm text-gray-600">
                {tiedPaths.map(id => pathById.get(id)?.title ?? id).join(' 与 ')}
                对你的分数相同，差异主要在于各自的代价与时间线，而不是谁更合适。
              </p>
            )}
          </div>
        )}

        {others.length > 0 && (
          <details className="mt-4">
            <summary className="cursor-pointer text-sm text-gray-600">
              查看其他 {others.length} 条路径
              {inapplicableCount > 0 && `（含 ${inapplicableCount} 条对你暂不适用）`}
            </summary>
            <ul className="mt-3 space-y-4">
              {others.map(path => (
                <li key={path.id} className="border p-4">
                  <div className="flex items-baseline justify-between">
                    <h3 className="font-medium">{pathById.get(path.id)?.title ?? path.id}</h3>
                    {pathById.get(path.id)?.status === 'draft' && (
                      <span className="text-xs text-amber-600">待核实</span>
                    )}
                  </div>

                  <p className="mt-1 text-sm text-gray-600">匹配度 {Math.round(path.match)}</p>

                  {!path.eligibility.applicable && (
                    <ul className="mt-2 text-sm text-red-600">
                      {path.eligibility.hardFailures.map(f => (
                        <li key={f.id}>不适用：{f.message}</li>
                      ))}
                    </ul>
                  )}

                  {path.eligibility.softWarnings.length > 0 && (
                    <ul className="mt-2 text-sm text-amber-600">
                      {path.eligibility.softWarnings.map(f => (
                        <li key={f.id}>注意：{f.message}</li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      {/* 解读与追问锚在主推荐路径上。没有可适用路径时无可锚定对象，整块不挂载 */}
      {main !== null && (
        <PathAssistant
          key={main.id}
          assessmentId={assessmentId}
          pathId={main.id}
          interpretation={interpretation}
        />
      )}
    </div>
  )
}

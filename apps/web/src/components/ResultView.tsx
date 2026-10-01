import type { DiagnosisResult, PathSummary } from '../api.js'

interface Props {
  result: DiagnosisResult
  paths: PathSummary[]
}

export function ResultView({ result, paths }: Props) {
  const pathById = new Map(paths.map(p => [p.id, p]))

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
        <h2 className="mb-2 text-lg font-semibold">路径匹配</h2>
        {result.paths.length === 0 ? (
          <p className="text-gray-500">暂无匹配路径</p>
        ) : (
          <ul className="space-y-4">
            {result.paths.map(path => {
              const meta = pathById.get(path.id)
              return (
                <li key={path.id} className="border p-4">
                  <div className="flex items-baseline justify-between">
                    <h3 className="font-medium">{meta?.title ?? path.id}</h3>
                    {meta?.status === 'draft' && (
                      <span className="text-xs text-amber-600">待核实</span>
                    )}
                  </div>

                  <p className="mt-1 text-sm text-gray-600">
                    匹配度 {Math.round(path.match)} · 置信度 {Math.round(path.confidence * 100)}%
                  </p>

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
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}

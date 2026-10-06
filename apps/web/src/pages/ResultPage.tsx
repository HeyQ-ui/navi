import { Redirect } from 'wouter'
import { ResultBody } from '../components/ResultBody.js'
import { useTitle } from '../lib/use-title.js'
import { useFlow } from '../state.js'

const SOURCE_LABELS: Record<string, string> = { self: '测测自己', other: '测测别人' }

/** 结果只存内存：直接访问或刷新后没有上下文就回首页（spec §4.2） */
export function ResultPage() {
  useTitle('测评结果 · Navi')
  const flow = useFlow()
  if (flow.result === null || flow.data === null) return <Redirect to="/" />

  return (
    <div className="mx-auto max-w-prose animate-rise px-6 py-14">
      <header className="mb-12">
        <p className="font-num text-[13px] font-medium tracking-wide text-ink-3">
          {SOURCE_LABELS[flow.source]}
        </p>
        <h1 className="mt-1 font-serif text-[34px] font-black leading-[1.3]">你的结果</h1>
      </header>
      <ResultBody
        result={flow.result}
        paths={flow.data.paths}
        tiedPaths={flow.result.tiedPaths}
        assessmentId={flow.result.assessmentId}
        interpretation={null}
      />
    </div>
  )
}

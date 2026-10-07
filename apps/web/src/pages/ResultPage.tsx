import { Redirect } from 'wouter'
import { ResultBody } from '../components/ResultBody.js'
import { SOURCE_LABELS } from '../lib/source-label.js'
import { useTitle } from '../lib/use-title.js'
import { useFlow } from '../state.js'

/** 结果只存内存：直接访问或刷新后没有上下文就回首页（spec §4.2） */
export function ResultPage() {
  useTitle('测评结果 · Navi')
  const flow = useFlow()

  // 提交在途：不能当成「没有结果」。wouter 的位置更新经 useSyncExternalStore
  // 以同步优先级提交，会先于 submit 里那次 setResult 落地——这一瞬间 result
  // 仍是 null，若在这里跳转，刚交完卷的人会被弹回封面。
  if (flow.result === null && flow.submitting) {
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

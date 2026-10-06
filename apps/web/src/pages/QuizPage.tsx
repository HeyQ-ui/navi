import { useEffect, useRef, useState } from 'react'
import { Redirect, useLocation } from 'wouter'
import type { Question } from '../api.js'
import { useFlow } from '../state.js'
import { useTitle } from '../lib/use-title.js'

const GROUP_SIZE = 5

/**
 * 作答只存内存（state.tsx），不落 localStorage：按「浏览器」暂存会串账号、
 * 串测评，题面一改还会让旧 id 虚高「已完成」计数。
 */
export function QuizPage() {
  useTitle('问卷 · Navi')
  const flow = useFlow()
  const [, navigate] = useLocation()
  const [page, setPage] = useState(0)
  const questions = flow.data?.questions ?? []

  const groups: Question[][] = []
  for (let i = 0; i < questions.length; i += GROUP_SIZE) {
    groups.push(questions.slice(i, i + GROUP_SIZE))
  }

  const answeredCount = Object.keys(flow.answers).length
  const current = groups[page] ?? []
  const currentComplete = current.every(q => flow.answers[q.id] !== undefined)
  const isLast = page === groups.length - 1
  const allComplete = answeredCount === questions.length

  // 会话在答题中途失效 → 登录后回跳自动重提一次，不重新答题（spec §4.2）
  const resubmitting = useRef(false)
  useEffect(() => {
    if (!flow.resubmitAfterLogin || flow.account === null || flow.submitting) return
    if (resubmitting.current) return
    resubmitting.current = true
    void flow.submit().then(outcome => {
      resubmitting.current = false
      if (outcome === 'ok') navigate('/result')
      else if (outcome === 'auth') navigate('/auth')
    })
  }, [flow.resubmitAfterLogin, flow.account, flow.submitting])

  // 状态守卫：没取过题就直接访问 /quiz（含刷新）时回首页（spec §4.2）。
  // 必须放在全部 hook 之后——守卫前的 hook 每次渲染都要按同样顺序执行
  if (flow.data === null) return <Redirect to="/" />

  async function onSubmit() {
    const outcome = await flow.submit()
    if (outcome === 'ok') navigate('/result')
    else if (outcome === 'auth') navigate('/auth')
  }

  return (
    <div className="mx-auto max-w-[680px] animate-rise px-6 py-14">
      <div className="mb-10">
        <p className="font-num text-[15px] font-semibold text-ink-2">
          {String(answeredCount).padStart(2, '0')} / {questions.length}
        </p>
        <div className="mt-2 h-[2px] w-full bg-line">
          <div
            className="h-[2px] bg-accent transition-all"
            style={{ width: `${questions.length === 0 ? 0 : (answeredCount / questions.length) * 100}%` }}
          />
        </div>
      </div>

      {current.map(question => (
        <fieldset key={question.id} className="mb-10">
          <legend className="mb-4 font-serif text-[18px] font-semibold leading-[1.7]">
            {question.text}
          </legend>
          <div className="space-y-2.5">
            {question.options.map((option, index) => (
              <label key={index} className="block cursor-pointer">
                <input
                  type="radio"
                  name={question.id}
                  className="peer sr-only"
                  checked={flow.answers[question.id] === index}
                  onChange={() => flow.setAnswer(question.id, index)}
                />
                <span
                  className={`block rounded-lg border px-5 py-3 text-[15px] transition-all peer-checked:border-accent peer-checked:bg-accent-soft ${
                    flow.answers[question.id] === index ? '' : 'border-line bg-surface hover:border-ink-3'
                  }`}
                >
                  {option}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      ))}

      {flow.submitError !== '' && (
        <p className="mb-4 rounded-lg border border-bad/30 bg-bad-soft p-3 text-[13px] text-bad">
          {flow.submitError}
        </p>
      )}

      <div className="flex items-center justify-between">
        <button
          type="button"
          className="btn-secondary px-5 py-2 disabled:opacity-40"
          disabled={page === 0}
          onClick={() => setPage(p => p - 1)}
        >
          上一组
        </button>
        {!isLast ? (
          <button
            type="button"
            className="btn-primary px-5 py-2 disabled:opacity-40"
            disabled={!currentComplete}
            onClick={() => setPage(p => p + 1)}
          >
            下一组
          </button>
        ) : (
          <button
            type="button"
            className="btn-primary px-6 py-2 disabled:opacity-40"
            disabled={!allComplete || flow.submitting}
            onClick={() => void onSubmit()}
          >
            {flow.submitting && <span className="spinner" />}
            {flow.submitting ? '正在计算……' : '提交'}
          </button>
        )}
      </div>
    </div>
  )
}

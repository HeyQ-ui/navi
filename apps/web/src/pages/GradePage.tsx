import { useState } from 'react'
import { useLocation } from 'wouter'
import { useFlow } from '../state.js'
import { useTitle } from '../lib/use-title.js'
import type { Grade } from '../api.js'

const GRADE_OPTIONS: ReadonlyArray<{ value: Grade; label: string }> = [
  { value: 'freshman', label: '大一' },
  { value: 'sophomore', label: '大二' },
  { value: 'junior', label: '大三' },
  { value: 'senior', label: '大四及以上' },
]

export function GradePage() {
  useTitle('选择年级 · Navi')
  const flow = useFlow()
  const [, navigate] = useLocation()
  const [picking, setPicking] = useState<Grade | null>(null)

  async function pick(value: Grade) {
    setPicking(value)
    const outcome = await flow.chooseGrade(value)
    setPicking(null)
    if (outcome === 'ok') navigate('/quiz')
    // 'empty' 留在本页显示「信息不足」，'error' 显示 questionsError（设计文档 §10）
  }

  const empty = flow.data !== null && flow.data.questions.length === 0

  return (
    <div className="mx-auto max-w-[560px] animate-rise px-6 py-20">
      <h1 className="font-serif text-[28px] font-black">先选择你现在的年级</h1>

      <div className="mt-8 space-y-3">
        {GRADE_OPTIONS.map(option => (
          <button
            key={option.value}
            type="button"
            disabled={picking !== null}
            onClick={() => void pick(option.value)}
            className="flex w-full items-center justify-between rounded-lg border border-line bg-surface px-5 py-4 text-left text-[16px] transition-all hover:-translate-y-px hover:border-accent hover:bg-accent-soft/40 disabled:opacity-60"
          >
            {option.label}
            {picking === option.value && <span className="spinner border-accent/30 border-t-accent" />}
          </button>
        ))}
      </div>

      {flow.questionsError !== '' && (
        <div className="mt-6 rounded-lg border border-bad/30 bg-bad-soft p-4 text-[14px] text-bad">
          <p>{flow.questionsError}</p>
          <button
            type="button"
            className="mt-2 underline underline-offset-4"
            onClick={() => { if (flow.grade !== null) void pick(flow.grade) }}
          >
            重试
          </button>
        </div>
      )}

      {empty && (
        <div className="mt-6 rounded-lg border border-line bg-surface p-4 text-[14px] text-ink-2">
          信息不足：当前没有可作答的题目，无法给出推荐。请换一个年级，或稍后再来。
        </div>
      )}
    </div>
  )
}

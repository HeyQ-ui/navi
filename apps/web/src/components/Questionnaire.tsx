import { useEffect, useState } from 'react'
import type { Question } from '../api.js'

interface Props {
  questions: Question[]
  onSubmit: (answers: Record<string, number>) => void
}

const GROUP_SIZE = 5
const STORAGE_KEY = 'navi.questionnaire.answers'

/** 读取暂存的答案。任何异常都退化为空对象——暂存失败不应阻断答题 */
function loadStoredAnswers(): Record<string, number> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return {}
    const parsed: unknown = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return parsed as Record<string, number>
  } catch {
    return {}
  }
}

export function Questionnaire({ questions, onSubmit }: Props) {
  const [answers, setAnswers] = useState<Record<string, number>>(loadStoredAnswers)
  const [page, setPage] = useState(0)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(answers))
    } catch {
      // 隐私模式或配额不足时静默忽略
    }
  }, [answers])

  const groups: Question[][] = []
  for (let i = 0; i < questions.length; i += GROUP_SIZE) {
    groups.push(questions.slice(i, i + GROUP_SIZE))
  }

  const answeredCount = Object.keys(answers).length
  const current = groups[page] ?? []
  const currentComplete = current.every(q => answers[q.id] !== undefined)
  const isLast = page === groups.length - 1
  const allComplete = answeredCount === questions.length

  function select(questionId: string, optionIndex: number) {
    setAnswers(prev => ({ ...prev, [questionId]: optionIndex }))
  }

  return (
    <div className="mx-auto max-w-3xl p-6">
      <p className="mb-4 text-sm text-gray-600">
        已完成 {answeredCount} / {questions.length}
      </p>

      {current.map(question => (
        <fieldset key={question.id} className="mb-6">
          <legend className="mb-2 font-medium">{question.text}</legend>
          {question.options.map((option, index) => (
            <label key={index} className="mb-1 flex cursor-pointer items-center gap-2">
              <input
                type="radio"
                name={question.id}
                checked={answers[question.id] === index}
                onChange={() => select(question.id, index)}
              />
              <span>{option}</span>
            </label>
          ))}
        </fieldset>
      ))}

      <div className="flex gap-3">
        {page > 0 && (
          <button type="button" onClick={() => setPage(p => p - 1)}>上一组</button>
        )}

        {!isLast && (
          <button type="button" disabled={!currentComplete} onClick={() => setPage(p => p + 1)}>
            下一组
          </button>
        )}

        {isLast && (
          <button
            type="button"
            disabled={!allComplete}
            onClick={() => onSubmit(answers)}
          >
            提交
          </button>
        )}
      </div>
    </div>
  )
}

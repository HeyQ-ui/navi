import { useState } from 'react'
import type { Question } from '../api.js'

interface Props {
  questions: Question[]
  onSubmit: (answers: Record<string, number>) => void
}

const GROUP_SIZE = 5

/**
 * 作答只活在**这一次**测试里：组件一挂载就是空白，不落 localStorage。
 *
 * 曾经把作答暂存到 localStorage 以便中途续填，代价是它按「浏览器」而不是按
 * 「账号 + 一次测试」保存，于是：
 * - 换账号、换一次测评，都会看到上一次的选择（同一个键，谁都能读到）；
 * - 题面改过之后，暂存里的旧题目 id 会让「已完成」计数虚高、提交按钮在还有题
 *   没答时就亮起来，提交上去还会被服务端按未知 id 拒成 400。
 *
 * 续填省下的那点事抵不过这些串味：学生看到的选择必须是他这次点出来的。
 * 每次重新进入一套测试都从空白开始。
 */
export function Questionnaire({ questions, onSubmit }: Props) {
  const [answers, setAnswers] = useState<Record<string, number>>({})
  const [page, setPage] = useState(0)

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

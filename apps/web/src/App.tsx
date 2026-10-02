import { useEffect, useState } from 'react'
import { fetchMe, fetchQuestions, postDiagnose } from './api.js'
import type { AssessmentSource, DiagnosisResponse, Grade, QuestionsResponse } from './api.js'
import { Login } from './components/Login.js'
import { Questionnaire } from './components/Questionnaire.js'
import { ResultView } from './components/ResultView.js'

type Stage = 'auth' | 'choosing' | 'grade' | 'loading' | 'questions' | 'result' | 'error'

const GRADE_OPTIONS: ReadonlyArray<{ value: Grade; label: string }> = [
  { value: 'freshman', label: '大一' },
  { value: 'sophomore', label: '大二' },
  { value: 'junior', label: '大三' },
  { value: 'senior', label: '大四及以上' },
]

export function App() {
  const [stage, setStage] = useState<Stage>('auth')
  const [username, setUsername] = useState('')
  const [source, setSource] = useState<AssessmentSource>('self')
  const [assessmentId, setAssessmentId] = useState('')
  const [grade, setGrade] = useState<Grade>('freshman')
  const [data, setData] = useState<QuestionsResponse | null>(null)
  const [result, setResult] = useState<DiagnosisResponse | null>(null)
  const [message, setMessage] = useState('')

  // 挂载时问一次服务端「我是谁」：已登录的用户不该被推回登录页
  useEffect(() => {
    void fetchMe().then(me => {
      if (me === null) return
      setUsername(me.username)
      setStage('choosing')
    })
  }, [])

  async function chooseGrade(value: Grade) {
    setGrade(value)
    setStage('loading')
    try {
      setData(await fetchQuestions(value))
      setStage('questions')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '加载失败')
      setStage('error')
    }
  }

  async function handleSubmit(answers: Record<string, number>) {
    try {
      const diagnosis = await postDiagnose(answers, grade, source)
      setResult(diagnosis)
      setAssessmentId(diagnosis.assessmentId)
      setStage('result')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '诊断失败')
      setStage('error')
    }
  }

  if (stage === 'auth') {
    return <Login onSuccess={name => { setUsername(name); setStage('choosing') }} />
  }

  if (stage === 'choosing') {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <h1 className="mb-2 text-xl font-semibold">你好，{username}</h1>
        <p className="mb-4 text-gray-600">
          这次要做的是谁的测评？两种都会留存记录，但只有「测测自己」的结果会用来给你解读。
        </p>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            className="border px-4 py-2"
            onClick={() => { setSource('self'); setStage('grade') }}
          >
            测测自己
          </button>
          <button
            type="button"
            className="border px-4 py-2"
            onClick={() => { setSource('other'); setStage('grade') }}
          >
            测测别人
          </button>
        </div>
      </div>
    )
  }

  if (stage === 'grade') {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <h1 className="mb-2 text-xl font-semibold">Navi</h1>
        <p className="mb-4 text-gray-600">
          先选择你现在的年级——不同年级看到的题目和判断依据不同。
        </p>
        <div className="flex flex-wrap gap-3">
          {GRADE_OPTIONS.map(option => (
            <button
              key={option.value}
              type="button"
              className="border px-4 py-2"
              onClick={() => chooseGrade(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
    )
  }

  if (stage === 'loading') return <p className="p-6">加载中……</p>

  if (stage === 'error') {
    return (
      <div className="p-6">
        <p className="text-red-600">{message}</p>
        <button type="button" onClick={() => setStage('grade')}>重新开始</button>
      </div>
    )
  }

  if (stage === 'result' && result !== null && data !== null) {
    return (
      <ResultView
        result={result}
        paths={data.paths}
        tiedPaths={result.tiedPaths}
        assessmentId={assessmentId}
      />
    )
  }

  if (data === null) return <p className="p-6">加载中……</p>

  // 没有可作答的题目时提前给出显式态，不让用户提交后撞 API 的 400（设计文档 §10）
  if (data.questions.length === 0) {
    return (
      <div className="p-6">
        <p className="text-gray-700">信息不足：当前没有可作答的题目，无法给出推荐。</p>
        <button type="button" onClick={() => setStage('grade')}>重新选择年级</button>
      </div>
    )
  }

  return <Questionnaire questions={data.questions} onSubmit={handleSubmit} />
}

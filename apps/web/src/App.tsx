import { useEffect, useState } from 'react'
import { fetchQuestions, postDiagnose } from './api.js'
import type { DiagnosisResult, QuestionsResponse } from './api.js'
import { Questionnaire } from './components/Questionnaire.js'
import { ResultView } from './components/ResultView.js'

type Stage = 'loading' | 'questions' | 'result' | 'error'

export function App() {
  const [stage, setStage] = useState<Stage>('loading')
  const [data, setData] = useState<QuestionsResponse | null>(null)
  const [result, setResult] = useState<DiagnosisResult | null>(null)
  const [message, setMessage] = useState('')

  useEffect(() => {
    fetchQuestions()
      .then(response => {
        setData(response)
        setStage('questions')
      })
      .catch(error => {
        setMessage(error instanceof Error ? error.message : '加载失败')
        setStage('error')
      })
  }, [])

  async function handleSubmit(answers: Record<string, number>) {
    try {
      setResult(await postDiagnose(answers))
      setStage('result')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '诊断失败')
      setStage('error')
    }
  }

  if (stage === 'loading') return <p className="p-6">加载中……</p>

  if (stage === 'error') {
    return (
      <div className="p-6">
        <p className="text-red-600">{message}</p>
        <button type="button" onClick={() => location.reload()}>重试</button>
      </div>
    )
  }

  if (stage === 'result' && result && data) {
    return <ResultView result={result} paths={data.paths} />
  }

  if (!data) return <p className="p-6">加载中……</p>

  return <Questionnaire questions={data.questions} onSubmit={handleSubmit} />
}

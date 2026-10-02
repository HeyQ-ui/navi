import { useEffect, useState } from 'react'
import { fetchAssessments } from '../api.js'
import type { AssessmentSummary } from '../api.js'

interface Props {
  onOpen: (id: string) => void
}

const GRADES: Record<string, string> = {
  freshman: '大一', sophomore: '大二', junior: '大三', senior: '大四及以上',
}

/** 只读的历次测评列表。主推荐路径的中文名由服务端随列表一起给，不必再取一次题库 */
export function History({ onOpen }: Props) {
  const [rows, setRows] = useState<AssessmentSummary[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    void fetchAssessments()
      .then(setRows)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : '加载失败'))
  }, [])

  if (error !== '') return <p className="p-6 text-red-600">{error}</p>
  if (rows === null) return <p className="p-6">加载中……</p>
  if (rows.length === 0) return <p className="p-6">还没有测评记录</p>

  return (
    <ul className="space-y-2">
      {rows.map(row => (
        <li key={row.id}>
          <button
            type="button"
            className="w-full border p-3 text-left"
            onClick={() => onOpen(row.id)}
          >
            <span className="font-medium">
              {row.source === 'self' ? '测测自己' : '测测别人'}
            </span>
            <span className="ml-2 text-sm text-gray-600">
              {row.grade === null ? '' : (GRADES[row.grade] ?? row.grade)}
              {' · '}
              {new Date(row.createdAt).toLocaleString('zh-CN')}
            </span>
            <span className="block text-sm">
              {row.mainPathTitle ?? '当前没有匹配的路径'}
              {row.match === null ? '' : ` · 匹配度 ${row.match}`}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}

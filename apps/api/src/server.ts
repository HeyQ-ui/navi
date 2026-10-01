import { Hono } from 'hono'
import { diagnose, findCloseMatches } from '@navi/core'
import type { Answers, KnowledgeBundle, Question } from '@navi/core'

type Grade = 'freshman' | 'sophomore' | 'junior' | 'senior'

const GRADES: readonly string[] = ['freshman', 'sophomore', 'junior', 'senior']

function parseGrade(value: unknown): Grade | undefined {
  return typeof value === 'string' && GRADES.includes(value) ? (value as Grade) : undefined
}

/**
 * 按年级过滤题目（设计文档 §5.4）。
 * 未声明 grades 的题目对所有年级通用；未指定年级时返回全部题目。
 */
function scopeQuestions(questions: Question[], grade: Grade | undefined): Question[] {
  if (grade === undefined) return questions
  return questions.filter(q => !q.grades || q.grades.length === 0 || q.grades.includes(grade))
}

export function createApp(bundle: KnowledgeBundle): Hono {
  const app = new Hono()

  app.get('/api/questions', c => {
    const grade = parseGrade(c.req.query('grade'))
    return c.json({
      questions: scopeQuestions(bundle.questions, grade),
      indicators: bundle.indicators,
      paths: bundle.paths.map(p => ({
        id: p.id, title: p.title, category: p.category,
        span: p.span, status: p.status, summary: p.summary,
      })),
    })
  })

  app.post('/api/diagnose', async c => {
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: '请求体不是合法 JSON' }, 400)
    }

    const answers = (body as { answers?: unknown } | null)?.answers
    if (answers === null || typeof answers !== 'object' || Array.isArray(answers)) {
      return c.json({ error: '缺少 answers 字段，或格式不是对象' }, 400)
    }

    const grade = parseGrade((body as { grade?: unknown }).grade)
    const scopedQuestions = scopeQuestions(bundle.questions, grade)

    // 全部题目必答（设计文档 §5.5）：部分作答会让 known 语义失真
    const answerIds = new Set(Object.keys(answers as Record<string, unknown>))
    const missing = scopedQuestions.filter(q => !answerIds.has(q.id)).map(q => q.id)
    if (missing.length > 0) {
      return c.json({ error: `以下题目未作答：${missing.join(', ')}` }, 400)
    }

    const scoped: KnowledgeBundle = { ...bundle, questions: scopedQuestions }
    const result = diagnose(answers as Answers, scoped)

    return c.json({
      ...result,
      closeMatches: findCloseMatches(result).map(p => p.id),
    })
  })

  app.get('/api/knowledge/:pathId', c => {
    const pathId = c.req.param('pathId')
    const path = bundle.paths.find(p => p.id === pathId)
    if (!path) return c.json({ error: `路径不存在：${pathId}` }, 404)

    return c.json({ path, blocks: bundle.blocks[pathId] ?? [] })
  })

  return app
}

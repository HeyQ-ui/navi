import { Hono } from 'hono'
import { diagnose } from '@navi/core'
import type { Answers, KnowledgeBundle } from '@navi/core'

export function createApp(bundle: KnowledgeBundle): Hono {
  const app = new Hono()

  app.get('/api/questions', c => {
    return c.json({
      questions: bundle.questions,
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

    const result = diagnose(answers as Answers, bundle)
    return c.json(result)
  })

  app.get('/api/knowledge/:pathId', c => {
    const pathId = c.req.param('pathId')
    const path = bundle.paths.find(p => p.id === pathId)
    if (!path) return c.json({ error: `路径不存在：${pathId}` }, 404)

    return c.json({ path, blocks: bundle.blocks[pathId] ?? [] })
  })

  return app
}

import { Hono } from 'hono'
import type { Context } from 'hono'
import { diagnose, findCloseMatches } from '@navi/core'
import type { Answers, KnowledgeBundle, Question } from '@navi/core'
import { streamChat, streamInterpret } from '@navi/llm'
import type { LanguageModel, ModelMessage } from 'ai'

type Grade = 'freshman' | 'sophomore' | 'junior' | 'senior'

const GRADES: readonly string[] = ['freshman', 'sophomore', 'junior', 'senior']

export interface AppOptions {
  /** 测试注入用；生产不传，走 DeepSeek */
  model?: LanguageModel
}

/** pathId 必须指向真实存在的路径——不能拿空路径去问模型 */
function findPathId(body: unknown, bundle: KnowledgeBundle): string | null {
  const pathId = String((body as { pathId?: unknown }).pathId ?? '')
  return bundle.paths.some(p => p.id === pathId) ? pathId : null
}

/** UI 消息（useChat 的格式）→ 纯文本对话历史。只取文本，不把 parts 结构传给模型 */
function toModelMessages(raw: unknown): ModelMessage[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap(message => {
    const { role, parts } = message as { role?: unknown; parts?: unknown }
    if (role !== 'user' && role !== 'assistant') return []
    const text = Array.isArray(parts)
      ? parts
          .filter((p): p is { type: 'text'; text: string } =>
            typeof p === 'object' && p !== null && (p as { type?: unknown }).type === 'text')
          .map(p => p.text)
          .join('')
      : ''
    return text === '' ? [] : [{ role, content: text }]
  })
}

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

export function createApp(bundle: KnowledgeBundle, options: AppOptions = {}): Hono {
  const app = new Hono()

  /**
   * 两个 LLM 端点共用的入参校验：答案须覆盖全部适用题目。
   * 通过时返回解析结果；失败时返回一个 Response，调用方直接 `return` 它。
   */
  function validate(c: Context, body: unknown):
    | { answers: Answers; grade: Grade | undefined; scopedQuestions: Question[] }
    | Response {
    const answers = (body as { answers?: unknown } | null)?.answers
    if (answers === null || typeof answers !== 'object' || Array.isArray(answers)) {
      return c.json({ error: '缺少 answers 字段，或格式不是对象' }, 400)
    }

    const grade = parseGrade((body as { grade?: unknown }).grade)
    const scopedQuestions = scopeQuestions(bundle.questions, grade)

    const answerIds = new Set(Object.keys(answers as Record<string, unknown>))
    const missing = scopedQuestions.filter(q => !answerIds.has(q.id)).map(q => q.id)
    if (missing.length > 0) {
      return c.json({ error: `以下题目未作答：${missing.join(', ')}` }, 400)
    }

    return { answers: answers as Answers, grade, scopedQuestions }
  }

  /** 两端点共用的请求体解析 */
  async function readBody(c: Context): Promise<unknown | Response> {
    try {
      return await c.req.json()
    } catch {
      return c.json({ error: '请求体不是合法 JSON' }, 400)
    }
  }

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

  app.post('/api/interpret', async c => {
    const body = await readBody(c)
    if (body instanceof Response) return body

    const parsed = validate(c, body)
    if (parsed instanceof Response) return parsed

    const pathId = findPathId(body, bundle)
    if (pathId === null) {
      const asked = String((body as { pathId?: unknown }).pathId ?? '')
      return c.json({ error: `路径不存在：${asked}` }, 404)
    }

    // 模型不可用时降级（设计文档 §8.7）：结构化结果仍由 /api/diagnose 完整提供，
    // 这里只让解读不可用——用一个明确的状态码，而不是半截流
    if (!options.model && !process.env.DEEPSEEK_API_KEY) {
      return c.json({ error: '个性化解读暂不可用：服务端未配置模型' }, 503)
    }

    const scoped: KnowledgeBundle = { ...bundle, questions: parsed.scopedQuestions }
    try {
      return streamInterpret(
        {
          answers: parsed.answers,
          grade: parsed.grade ?? 'freshman',
          pathId,
          bundle: scoped,
        },
        options,
      ).toTextStreamResponse()
    } catch (error) {
      return c.json({ error: `个性化解读暂不可用：${(error as Error).message}` }, 503)
    }
  })

  app.post('/api/chat', async c => {
    const body = await readBody(c)
    if (body instanceof Response) return body

    const parsed = validate(c, body)
    if (parsed instanceof Response) return parsed

    const pathId = findPathId(body, bundle)
    if (pathId === null) {
      const asked = String((body as { pathId?: unknown }).pathId ?? '')
      return c.json({ error: `路径不存在：${asked}` }, 404)
    }

    const messages = toModelMessages((body as { messages?: unknown }).messages)
    if (messages.length === 0) {
      return c.json({ error: 'messages 为空' }, 400)
    }

    if (!options.model && !process.env.DEEPSEEK_API_KEY) {
      return c.json({ error: '追问暂不可用：服务端未配置模型' }, 503)
    }

    const scoped: KnowledgeBundle = { ...bundle, questions: parsed.scopedQuestions }
    try {
      return streamChat(
        {
          answers: parsed.answers,
          grade: parsed.grade ?? 'freshman',
          pathId,
          messages,
          bundle: scoped,
        },
        options,
      ).toUIMessageStreamResponse()
    } catch (error) {
      return c.json({ error: `追问暂不可用：${(error as Error).message}` }, 503)
    }
  })

  app.get('/api/knowledge/:pathId', c => {
    const pathId = c.req.param('pathId')
    const path = bundle.paths.find(p => p.id === pathId)
    if (!path) return c.json({ error: `路径不存在：${pathId}` }, 404)

    return c.json({ path, blocks: bundle.blocks[pathId] ?? [] })
  })

  return app
}

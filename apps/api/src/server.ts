import { Hono } from 'hono'
import type { Context } from 'hono'
import { FIVE_POINT_SCALE, diagnose, findTiedPaths } from '@navi/core'
import type { Answers, KnowledgeBundle, Question } from '@navi/core'
import { streamChat, streamInterpret } from '@navi/llm'
import type { HistoryAssessment } from '@navi/llm'
import type { LanguageModel } from 'ai'
import { openStore, defaultDbPath } from './store.js'
import type { Store, Source, AssessmentRecord } from './store.js'
import { registerAuthRoutes, requireSession, sessionUser } from './auth.js'

type Grade = 'freshman' | 'sophomore' | 'junior' | 'senior'

const GRADES: readonly string[] = ['freshman', 'sophomore', 'junior', 'senior']

/** 上下文里最多带几条对话消息（一问一答各算一条）。§8.5「最近 N 轮」 */
const MAX_CHAT_MESSAGES = 20
/** 单轮追问的问题字符上限。超过视为异常输入，直接拒绝而不是静默截断 */
const MAX_CHAT_CHARS = 8000
/** 上下文里最多带几次历次自我测评（不含当次）。专项 §11.4 */
const MAX_HISTORY_ASSESSMENTS = 4

export interface AppOptions {
  /** 测试注入用；生产不传，走 DeepSeek */
  model?: LanguageModel
  /** 会话签名密钥。未配置时认证与受保护端点一律 503 */
  jwtSecret?: string
  /** 测试注入用；生产不传，懒开 apps/api/data/navi.db */
  store?: Store
}

/** 测评来源。缺省 self；非法值返回 null（调用方转 400） */
function parseSource(value: unknown): Source | null {
  if (value === undefined) return 'self'
  return value === 'self' || value === 'other' ? value : null
}

type StreamResult = ReturnType<typeof streamInterpret>

/**
 * 流正常结束后把解读全文补写回记录（spec §4.7）。
 *
 * 必须在 finishReason 上设闸门：`.text` 在流中途出错时会**静默 resolve 出已累积的
 * 半截文本**，不抛错（packages/llm/src/index.test.ts:126 记录了这个缺陷）。
 * 直接 `await .text` 再写库会把残缺解读存进去，而它会被当成「已生成」从此不再重算
 * ——这是最坏的组合。已实测：正常流 finishReason 为 'stop'，中途出错为 'error'，
 * 且响应体被消费后该 promise 照常 resolve。
 */
function persistInterpretation(stream: StreamResult, store: Store, recordId: string): void {
  void (async () => {
    try {
      if (await stream.finishReason !== 'stop') return
      const text = await stream.text
      if (text.trim() === '') return
      store.setInterpretation(recordId, text)
    } catch {
      // 写失败只记日志：响应已经开始流向用户，这里不该再抛
      console.warn(`[api] 解读写入失败：${recordId}`)
    }
  })()
}

/**
 * 该用户最近几次自我测评的摘要（**不含当次**），时间倒序。
 *
 * 来源过滤在 `listAssessments` 上做一半、这里做另一半：`listAssessments` 返回本人
 * 全部记录，这里只留 `source='self'` 并把当次排除掉——当次已单独进上下文，
 * 重复列会让「你的变化」段算错一次（专项 §7、§11.4）。
 */
function selfHistory(store: Store, userId: string, currentId: string): HistoryAssessment[] {
  return store.listAssessments(userId)
    .filter(row => row.source === 'self' && row.id !== currentId)
    .slice(0, MAX_HISTORY_ASSESSMENTS)
    .map(row => ({ createdAt: row.createdAt, result: row.result }))
}

/**
 * 一轮问答落库。与 persistInterpretation 同一个闸门、同一个理由：
 * `.text` 在流中途出错时会**静默 resolve 出已累积的半截文本**
 * （packages/llm/src/index.test.ts 里钉着这个缺陷）。半截回答一旦落库，
 * 就成了后续**所有**上下文的既定事实，比半截解读更毒。
 *
 * user 与 assistant 两条一起写：失败的轮次什么都不落库，否则上下文会留下
 * 「用户问了但没人答」的悬空轮次（专项 §11.3）。
 */
function persistTurn(
  stream: StreamResult,
  store: Store,
  ctx: {
    userId: string
    assessmentId: string
    pathId: string
    source: Source
    userText: string
  },
): void {
  void (async () => {
    try {
      if (await stream.finishReason !== 'stop') return
      const text = await stream.text
      if (text.trim() === '') return
      store.appendTurn({ ...ctx, assistantText: text })
    } catch {
      console.warn(`[api] 对话写入失败：${ctx.assessmentId}`)
    }
  })()
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

type AnswersValidation =
  | { ok: true; answers: Answers; grade: Grade | undefined; scopedQuestions: Question[] }
  | { ok: false; error: string }

/**
 * 三个端点共用的 answers 校验（设计文档 §5.5）。
 *
 * 三层检查，缺一不可：
 * 1. 本次问卷的题目必须全答（部分作答会让 known 语义失真）
 * 2. 不得夹带知识库里根本不存在的题目 id（题目改 id 后的旧客户端、被篡改的 body）
 * 3. 取值必须是 0–4 的整数（越界值会被当成未作答，静默产出一份失真的画像）
 *
 * 注意：**属于其他年级的题目 id 是允许的**，会在 `scopeQuestions` 处被过滤掉。
 * 这是刻意的容忍（`server.test.ts` 的「年级分流」用例固定了它），前端把
 * localStorage 里的历史答案一并提交时会用到。
 */
function validateAnswers(bundle: KnowledgeBundle, body: unknown): AnswersValidation {
  const answers = (body as { answers?: unknown } | null)?.answers
  if (answers === null || typeof answers !== 'object' || Array.isArray(answers)) {
    return { ok: false, error: '缺少 answers 字段，或格式不是对象' }
  }

  const grade = parseGrade((body as { grade?: unknown }).grade)
  const scopedQuestions = scopeQuestions(bundle.questions, grade)
  const record = answers as Record<string, unknown>

  const missing = scopedQuestions.filter(q => !(q.id in record)).map(q => q.id)
  if (missing.length > 0) {
    return { ok: false, error: `以下题目未作答：${missing.join(', ')}` }
  }

  const knownIds = new Set(bundle.questions.map(q => q.id))
  const unknown = Object.keys(record).filter(id => !knownIds.has(id))
  if (unknown.length > 0) {
    return { ok: false, error: `以下题目 id 不存在：${unknown.join(', ')}` }
  }

  const outOfRange = Object.entries(record)
    .filter(([, value]) =>
      !Number.isInteger(value) || (value as number) < 0 || (value as number) >= FIVE_POINT_SCALE.length)
    .map(([id]) => id)
  if (outOfRange.length > 0) {
    return {
      ok: false,
      error: `以下题目的取值不是 0–${FIVE_POINT_SCALE.length - 1} 的整数：${outOfRange.join(', ')}`,
    }
  }

  return { ok: true, answers: record as Answers, grade, scopedQuestions }
}

export function createApp(bundle: KnowledgeBundle, options: AppOptions = {}): Hono {
  const app = new Hono()

  let lazyStore: Store | null = null
  function getStore(): Store {
    // 懒开：只有真用到存储的端点才会落盘。若在装配期就打开，
    // 那些只用 createApp(bundle) 的公开端点测试会在仓库里创建出真实数据库文件。
    lazyStore ??= options.store ?? openStore(defaultDbPath())
    return lazyStore
  }

  // 传的是 thunk 本身而不是调用结果——写成 getStore() 就等于在装配期打开数据库
  const auth = { store: getStore, jwtSecret: options.jwtSecret ?? process.env.JWT_SECRET }
  registerAuthRoutes(app, auth)

  /** 各端点共用的请求体解析 */
  async function readBody(c: Context): Promise<unknown | Response> {
    try {
      return await c.req.json()
    } catch {
      return c.json({ error: '请求体不是合法 JSON' }, 400)
    }
  }

  /**
   * 按 assessmentId 取本人的记录；取不到返回 404 响应。
   * 「不存在」与「不属于本人」合并成同一个 404，不泄露他人记录的存在性。
   */
  function loadRecord(c: Context, store: Store, body: unknown): AssessmentRecord | Response {
    const id = String((body as { assessmentId?: unknown }).assessmentId ?? '')
    const record = store.findAssessment(id, sessionUser(c).id)
    if (record === null) return c.json({ error: `测评记录不存在：${id}` }, 404)
    return record
  }

  /** pathId 必须是这条记录快照里真实存在的路径——不能拿空路径去问模型 */
  function pathIdInRecord(body: unknown, record: AssessmentRecord): string | null {
    const id = String((body as { pathId?: unknown }).pathId ?? '')
    return record.result.paths.some(p => p.id === id) ? id : null
  }

  /** 前端渲染结果页需要的路径摘要（不含内容块，内容块由 /api/knowledge/:pathId 提供） */
  function pathSummaries() {
    return bundle.paths.map(p => ({
      id: p.id, title: p.title, category: p.category,
      span: p.span, status: p.status, summary: p.summary,
    }))
  }

  app.get('/api/questions', c => {
    const grade = parseGrade(c.req.query('grade'))
    return c.json({
      questions: scopeQuestions(bundle.questions, grade),
      indicators: bundle.indicators,
      paths: pathSummaries(),
    })
  })

  app.post('/api/diagnose', requireSession(auth), async c => {
    const body = await readBody(c)
    if (body instanceof Response) return body

    const v = validateAnswers(bundle, body)
    if (!v.ok) return c.json({ error: v.error }, 400)

    const source = parseSource((body as { source?: unknown }).source)
    if (source === null) return c.json({ error: 'source 只能是 self 或 other' }, 400)

    const scoped: KnowledgeBundle = { ...bundle, questions: v.scopedQuestions }
    const result = diagnose(v.answers, scoped)

    // 落库在服务端内部：手里已经有 answers 与刚算出的 result，不必让客户端再发一次，
    // 也不用信客户端说「存什么」。只 INSERT，历史因此天然是追加的。
    const assessmentId = getStore().createAssessment({
      userId: sessionUser(c).id,
      source,
      grade: v.grade ?? null,
      answers: v.answers,
      result,
    })

    return c.json({
      ...result,
      tiedPaths: findTiedPaths(result).map(p => p.id),
      assessmentId,
    })
  })

  app.post('/api/interpret', requireSession(auth), async c => {
    const body = await readBody(c)
    if (body instanceof Response) return body

    const record = loadRecord(c, getStore(), body)
    if (record instanceof Response) return record

    const pathId = pathIdInRecord(body, record)
    if (pathId === null) {
      const asked = String((body as { pathId?: unknown }).pathId ?? '')
      return c.json({ error: `路径不存在：${asked}` }, 404)
    }

    // 模型不可用时降级（设计文档 §8.7）：结构化结果仍由 /api/diagnose 完整提供，
    // 这里只让解读不可用——用一个明确的状态码，而不是半截流
    if (!options.model && !process.env.DEEPSEEK_API_KEY) {
      return c.json({ error: '个性化解读暂不可用：服务端未配置模型' }, 503)
    }

    const scoped: KnowledgeBundle = {
      ...bundle, questions: scopeQuestions(bundle.questions, parseGrade(record.grade)),
    }
    // 解读的上下文与 chat 对齐（取值方式完全一致）：「你的变化」段要靠 these
    const userId = sessionUser(c).id
    const interpretStore = getStore()
    const conversation = interpretStore.recentTurns(userId, record.id, MAX_CHAT_MESSAGES)
      .map(turn => ({ role: turn.role, content: turn.content }))

    try {
      const stream = streamInterpret(
        {
          answers: record.answers,
          pathId,
          bundle: scoped,
          // result 用落库的快照而非重算：页面显示的就是它，重算会让解释与显示不一致
          result: record.result,
          history: selfHistory(interpretStore, userId, record.id),
          conversation,
        },
        options,
      )
      const response = stream.toTextStreamResponse()
      persistInterpretation(stream, getStore(), record.id)
      return response
    } catch (error) {
      // 只兜得住同步的装配期错误（读提示词失败等）。超时/欠费发生在流被消费之后，
      // 那时 200 已经发出，由前端把流错误显示成「暂不可用」。
      return c.json({ error: `个性化解读暂不可用：${(error as Error).message}` }, 503)
    }
  })

  app.post('/api/chat', requireSession(auth), async c => {
    const body = await readBody(c)
    if (body instanceof Response) return body

    const record = loadRecord(c, getStore(), body)
    if (record instanceof Response) return record

    const pathId = pathIdInRecord(body, record)
    if (pathId === null) {
      const asked = String((body as { pathId?: unknown }).pathId ?? '')
      return c.json({ error: `路径不存在：${asked}` }, 404)
    }

    // 只收本轮问题。历史一律从自己的库读——请求体里的 messages 一概不看，
    // 与 assessmentId 同理：记录是服务端写的，客户端改不了，而请求体谁都能改。
    const rawQuestion = (body as { question?: unknown }).question
    const question = typeof rawQuestion === 'string' ? rawQuestion.trim() : ''
    if (question === '') return c.json({ error: 'question 为空' }, 400)
    if (question.length > MAX_CHAT_CHARS) {
      return c.json({ error: `追问内容过长：${question.length} 字符，上限 ${MAX_CHAT_CHARS}` }, 400)
    }

    if (!options.model && !process.env.DEEPSEEK_API_KEY) {
      return c.json({ error: '追问暂不可用：服务端未配置模型' }, 503)
    }

    const userId = sessionUser(c).id
    const store = getStore()
    const conversation = store.recentTurns(userId, record.id, MAX_CHAT_MESSAGES)
      .map(turn => ({ role: turn.role, content: turn.content }))

    const scoped: KnowledgeBundle = {
      ...bundle, questions: scopeQuestions(bundle.questions, parseGrade(record.grade)),
    }
    try {
      const stream = streamChat({
        answers: record.answers,
        pathId,
        bundle: scoped,
        result: record.result,
        history: selfHistory(store, userId, record.id),
        conversation,
        messages: [{ role: 'user', content: question }],
      }, options)
      const response = stream.toUIMessageStreamResponse()
      persistTurn(stream, store, {
        userId, assessmentId: record.id, pathId, source: record.source, userText: question,
      })
      return response
    } catch (error) {
      // 同 /api/interpret：只兜同步装配期错误，流中途失败由前端降级
      return c.json({ error: `追问暂不可用：${(error as Error).message}` }, 503)
    }
  })

  /** 账号级对话历史：前端首次渲染时用它 seed，之后每轮只发新问题（专项 §11.3） */
  app.get('/api/chat/history', requireSession(auth), c => {
    const turns = getStore().recentTurns(sessionUser(c).id, null, MAX_CHAT_MESSAGES)
    return c.json({
      turns: turns.map(t => ({
        id: t.id, role: t.role, content: t.content, createdAt: t.createdAt,
      })),
    })
  })

  /** 历史列表：主推荐路径与匹配度由该条 result 快照推出，不另立算法（§9.3） */
  app.get('/api/assessments', requireSession(auth), c => {
    const rows = getStore().listAssessments(sessionUser(c).id)
    const titles = new Map(bundle.paths.map(p => [p.id, p.title]))

    const assessments = []
    for (const row of rows) {
      // 逐行兜住：库里的 result 可能是旧 schema 残留——有 paths 数组、但元素里没有
      // eligibility（字段改名就是这种形态）。findTiedPaths 会读 p.eligibility.applicable
      // 而抛错，一行坏数据就把整个历史列表打成 500。
      // 守卫放在「用到它的地方」，因为只有这里知道推导需要什么形状。
      try {
        const main = findTiedPaths(row.result)[0]
        assessments.push({
          id: row.id,
          source: row.source,
          grade: row.grade,
          createdAt: row.createdAt,
          mainPathId: main?.id ?? null,
          // 标题由服务端补，前端就不必为了显示中文名再取一次 /api/questions
          mainPathTitle: main === undefined ? null : (titles.get(main.id) ?? main.id),
          match: main === undefined ? null : Math.round(main.match),
        })
      } catch {
        console.warn(`[api] 跳过无法汇总的测评记录：${row.id}`)
      }
    }

    return c.json({ assessments })
  })

  app.get('/api/assessments/:id', requireSession(auth), c => {
    const record = getStore().findAssessment(c.req.param('id'), sessionUser(c).id)
    if (record === null) return c.json({ error: '测评记录不存在' }, 404)

    const tied = findTiedPaths(record.result)
    return c.json({
      id: record.id,
      source: record.source,
      grade: record.grade,
      createdAt: record.createdAt,
      answers: record.answers,
      result: record.result,
      interpretation: record.interpretation,
      mainPathId: tied[0]?.id ?? null,
      tiedPaths: tied.map(p => p.id),
      // 自带宽渲染结果页所需的路径摘要，让历史详情只需一次请求
      paths: pathSummaries(),
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

import { describe, it, expect, vi } from 'vitest'
import { simulateReadableStream } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'
import type { LanguageModel } from 'ai'
import { createApp } from './server.js'
import { openStore } from './store.js'
import type { Store } from './store.js'
import type { KnowledgeBundle } from '@navi/core'

/** 会说固定话的 mock 模型；形状与 packages/llm 的冒烟测试一致 */
function mockModel(text: string): MockLanguageModelV3 {
  return new MockLanguageModelV3({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: 'text-start', id: '1' },
          { type: 'text-delta', id: '1', delta: text },
          { type: 'text-end', id: '1' },
          {
            type: 'finish',
            finishReason: { unified: 'stop', raw: undefined },
            usage: {
              inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
              outputTokens: { total: 1, text: 1, reasoning: undefined },
            },
          },
        ],
      }),
    }),
  })
}

function q(id: string, indicator: string) {
  return { id, indicator: indicator as never, text: id, options: ['a','b','c','d','e'], weight: 1 }
}

const bundle: KnowledgeBundle = {
  indicators: [{ id: 'academic-interest', name: '学术志趣' }],
  questions: [q('q1', 'academic-interest'), q('q2', 'academic-interest'), q('q3', 'academic-interest')],
  archetypes: [{
    id: 'steady-scholar', name: '稳健学术型',
    vector: { 'academic-interest': 90 },
    narrative: { oneLiner: '', strengths: [], blindspots: [] },
  }],
  paths: [{
    id: 'same-discipline-baoyan', title: '本学科保研',
    category: 'academic', span: 'same-discipline', status: 'verified', summary: '',
    weights: [{ indicator: 'academic-interest', weight: 1, ideal: 90 }],
    eligibility: [],
  }],
  blocks: { 'same-discipline-baoyan': [{ type: 'timeline', html: '<p>时间线</p>', raw: '时间线' }] },
  boundaries: [],
}

const okAnswers = { q1: 4, q2: 4, q3: 4 }

function post(
  app: ReturnType<typeof createApp>, path: string, body: unknown, cookie?: string,
) {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (cookie !== undefined) headers.cookie = cookie
  return app.request(path, { method: 'POST', headers, body: JSON.stringify(body) })
}

/**
 * 建一个已登录的 app：注册一个测试用户，返回 app 与它的会话 cookie。
 * 测评端点现在都要会话，逐个用例手写注册样板会让文件不可读。
 */
async function authedApp(
  b: KnowledgeBundle = bundle,
  options: { model?: LanguageModel; jwtSecret?: string; store?: Store } = {},
) {
  const store = options.store ?? openStore(':memory:')
  const app = createApp(b, { jwtSecret: 'test-secret', ...options, store })
  const res = await app.request('/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'tester', password: 'pw123456' }),
  })
  const cookie = res.headers.get('set-cookie')!.split(';')[0]!
  return { app, cookie, store }
}

/** 直接查库断言时用：测试里只注册过 tester 一个用户 */
function meId(store: Store): string {
  const user = store.verifyUser('tester', 'pw123456')
  if (user === null) throw new Error('测试用户不存在')
  return user.id
}

/** 先做一次诊断，拿到它的 assessmentId——interpret / chat 现在都要它 */
async function diagnoseOnce(
  app: ReturnType<typeof createApp>, cookie: string, body: unknown = { answers: okAnswers, grade: 'freshman' },
) {
  const res = await post(app, '/api/diagnose', body, cookie)
  return ((await res.json()) as { assessmentId: string }).assessmentId
}

describe('GET /api/questions', () => {
  it('返回题目、指标与路径定义', async () => {
    const res = await createApp(bundle).request('/api/questions')
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      questions: unknown[]; indicators: unknown[]; paths: unknown[]
    }
    expect(body.questions).toHaveLength(3)
    expect(body.indicators).toHaveLength(1)
    expect(body.paths).toHaveLength(1)
  })

  it('不下发路径内容块——内容块由 /api/knowledge/:pathId 单独提供', async () => {
    const res = await createApp(bundle).request('/api/questions')
    const body = (await res.json()) as Record<string, unknown>
    expect(body).not.toHaveProperty('blocks')
  })

  it('浏览题库不需要登录（登录只挡测评，spec §4.3）', async () => {
    expect((await createApp(bundle).request('/api/questions')).status).toBe(200)
  })
})

describe('POST /api/diagnose', () => {
  it('返回结构化诊断结果', async () => {
    const { app, cookie } = await authedApp()
    const res = await post(app, '/api/diagnose', { answers: okAnswers }, cookie)
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      paths: Array<{ id: string }>
      indicators: Record<string, { known: boolean }>
    }
    expect(body.paths[0]!.id).toBe('same-discipline-baoyan')
    expect(body.indicators['academic-interest']!.known).toBe(true)
  })

  it('响应中不含任何模型生成内容', async () => {
    const { app, cookie } = await authedApp()
    const res = await post(app, '/api/diagnose', { answers: okAnswers }, cookie)
    const body = (await res.json()) as Record<string, unknown>
    expect(body).not.toHaveProperty('interpretation')
    expect(body).not.toHaveProperty('text')
  })

  it('请求体缺少 answers 时返回 400', async () => {
    const { app, cookie } = await authedApp()
    const res = await post(app, '/api/diagnose', {}, cookie)
    expect(res.status).toBe(400)
  })

  it('answers 不是对象时返回 400 而不是 500', async () => {
    const { app, cookie } = await authedApp()
    const res = await post(app, '/api/diagnose', { answers: 'nonsense' }, cookie)
    expect(res.status).toBe(400)
  })

  it('请求体不是合法 JSON 时返回 400', async () => {
    const { app, cookie } = await authedApp()
    const res = await app.request('/api/diagnose', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: '{not json',
    })
    expect(res.status).toBe(400)
  })

  it('落库并返回 assessmentId；同一用户重复测评累积两条记录', async () => {
    const store = openStore(':memory:')
    const { app, cookie } = await authedApp(bundle, { store })
    const res = await post(app, '/api/diagnose', { answers: okAnswers }, cookie)
    const body = (await res.json()) as { assessmentId: string }
    expect(body.assessmentId).toBeTruthy()

    await post(app, '/api/diagnose', { answers: okAnswers }, cookie)
    expect(store.listAssessments(meId(store))).toHaveLength(2)
  })

  it('source 落库正确；缺省为 self，非法值 400', async () => {
    const store = openStore(':memory:')
    const { app, cookie } = await authedApp(bundle, { store })

    await post(app, '/api/diagnose', { answers: okAnswers }, cookie)
    await post(app, '/api/diagnose', { answers: okAnswers, source: 'other' }, cookie)
    expect(store.listAssessments(meId(store)).map(r => r.source).sort()).toEqual(['other', 'self'])

    const bad = await post(app, '/api/diagnose', { answers: okAnswers, source: 'nonsense' }, cookie)
    expect(bad.status).toBe(400)
  })

  it('未带会话 cookie 时返回 401', async () => {
    const { app } = await authedApp()
    const res = await post(app, '/api/diagnose', { answers: okAnswers })
    expect(res.status).toBe(401)
  })
})

describe('GET /api/knowledge/:pathId', () => {
  it('返回该路径的内容块', async () => {
    const res = await createApp(bundle).request('/api/knowledge/same-discipline-baoyan')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { blocks: Array<{ type: string }> }
    expect(body.blocks[0]!.type).toBe('timeline')
  })

  it('路径不存在时返回 404', async () => {
    const res = await createApp(bundle).request('/api/knowledge/not-exist')
    expect(res.status).toBe(404)
  })
})

const gradedBundle: KnowledgeBundle = {
  ...bundle,
  questions: [
    q('common-1', 'academic-interest'),
    { ...q('fresh-1', 'academic-interest'), grades: ['freshman'] },
    { ...q('senior-1', 'academic-interest'), grades: ['sophomore', 'junior', 'senior'] },
  ],
}

describe('年级分流（设计文档 §5.4）', () => {
  it('未指定年级时返回全部题目', async () => {
    const res = await createApp(gradedBundle).request('/api/questions')
    const body = (await res.json()) as { questions: Array<{ id: string }> }
    expect(body.questions.map(x => x.id)).toEqual(['common-1', 'fresh-1', 'senior-1'])
  })

  it('指定大一（含别名）时排除高年级专属题目', async () => {
    const res = await createApp(gradedBundle).request('/api/questions?grade=freshman')
    const body = (await res.json()) as { questions: Array<{ id: string }> }
    expect(body.questions.map(x => x.id)).toEqual(['common-1', 'fresh-1'])
  })

  it('指定大三时排除大一专属题目', async () => {
    const res = await createApp(gradedBundle).request('/api/questions?grade=junior')
    const body = (await res.json()) as { questions: Array<{ id: string }> }
    expect(body.questions.map(x => x.id)).toEqual(['common-1', 'senior-1'])
  })

  it('diagnose 同样按年级过滤，避免跨年级题目混算', async () => {
    const { app, cookie } = await authedApp(gradedBundle)
    const res = await post(app, '/api/diagnose', {
      grade: 'freshman', answers: { 'common-1': 4, 'fresh-1': 4, 'senior-1': 0 },
    }, cookie)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { indicators: Record<string, { sources: string[] }> }
    expect(body.indicators['academic-interest']!.sources).not.toContain('senior-1')
  })
})

describe('答案完整性与接近路径（设计文档 §5.5、§10）', () => {
  it('答案不完整时返回 400，而不是静默用部分题目计分', async () => {
    const { app, cookie } = await authedApp()
    const res = await post(app, '/api/diagnose', { answers: { q1: 4 } }, cookie)
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('q2')
  })

  it('响应中给出与主推荐路径显示分相同的路径 id 列表', async () => {
    const { app, cookie } = await authedApp()
    const res = await post(app, '/api/diagnose', { answers: okAnswers }, cookie)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { tiedPaths: string[] }
    expect(body.tiedPaths).toEqual(['same-discipline-baoyan'])
  })
})

describe('answers 校验（Review Focus #2：不可信输入挡在模型之外）', () => {
  it('/api/diagnose 拒绝夹带的不存在题目 id', async () => {
    const { app, cookie } = await authedApp()
    const res = await post(app, '/api/diagnose', { answers: { ...okAnswers, ghost: 3 }, grade: 'freshman' }, cookie)
    expect(res.status).toBe(400)
  })

  it('/api/diagnose 拒绝越界的取值', async () => {
    const { app, cookie } = await authedApp()
    const res = await post(app, '/api/diagnose', { answers: { ...okAnswers, q1: -1 }, grade: 'freshman' }, cookie)
    expect(res.status).toBe(400)
  })
})

describe('POST /api/interpret', () => {
  it('返回流式解读文本', async () => {
    const { app, cookie } = await authedApp(bundle, { model: mockModel('你现在的位置是大一。') })
    const assessmentId = await diagnoseOnce(app, cookie)
    const res = await post(app, '/api/interpret',
      { assessmentId, pathId: 'same-discipline-baoyan' }, cookie)
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('你现在的位置是大一。')
  })

  it('请求体里夹带 answers 也没用——服务端只认记录里的那份', async () => {
    const { app, cookie } = await authedApp(bundle, { model: mockModel('正常解读') })
    const assessmentId = await diagnoseOnce(app, cookie)
    const res = await post(app, '/api/interpret', {
      assessmentId, pathId: 'same-discipline-baoyan', answers: { ghost: 3 }, grade: 'senior',
    }, cookie)
    expect(res.status).toBe(200)
  })

  it('assessmentId 不存在或不属于本人时返回 404，不进入模型', async () => {
    let called = false
    const spy = new MockLanguageModelV3({
      doStream: async () => { called = true; throw new Error('不该被调用') },
    }) as unknown as LanguageModel
    const { app, cookie } = await authedApp(bundle, { model: spy })
    const res = await post(app, '/api/interpret',
      { assessmentId: 'not-exist', pathId: 'same-discipline-baoyan' }, cookie)
    expect(res.status).toBe(404)
    expect(called).toBe(false)
  })

  it('pathId 不在这条记录里时返回 404，不进入模型', async () => {
    let called = false
    const spy = new MockLanguageModelV3({
      doStream: async () => { called = true; throw new Error('不该被调用') },
    }) as unknown as LanguageModel
    const { app, cookie } = await authedApp(bundle, { model: spy })
    const assessmentId = await diagnoseOnce(app, cookie)
    const res = await post(app, '/api/interpret',
      { assessmentId, pathId: 'not-exist' }, cookie)
    expect(res.status).toBe(404)
    expect(called).toBe(false)
  })

  it('未带会话 cookie 时返回 401', async () => {
    const { app, cookie } = await authedApp(bundle, { model: mockModel('不该出现') })
    const assessmentId = await diagnoseOnce(app, cookie)
    const res = await post(app, '/api/interpret',
      { assessmentId, pathId: 'same-discipline-baoyan' })
    expect(res.status).toBe(401)
  })

  it('未配置 API Key 且没有注入模型时返回 503，而不是 500', async () => {
    const saved = process.env.DEEPSEEK_API_KEY
    delete process.env.DEEPSEEK_API_KEY
    try {
      const { app, cookie } = await authedApp()
      const assessmentId = await diagnoseOnce(app, cookie)
      const res = await post(app, '/api/interpret',
        { assessmentId, pathId: 'same-discipline-baoyan' }, cookie)
      expect(res.status).toBe(503)
    } finally {
      if (saved !== undefined) process.env.DEEPSEEK_API_KEY = saved
    }
  })

  it('流正常结束后，解读全文写入该记录', async () => {
    const store = openStore(':memory:')
    const { app, cookie } = await authedApp(bundle, {
      model: mockModel('你现在的位置是大一。'), store,
    })
    const assessmentId = await diagnoseOnce(app, cookie)

    const res = await post(app, '/api/interpret',
      { assessmentId, pathId: 'same-discipline-baoyan' }, cookie)
    expect(res.status).toBe(200)
    await res.text() // 必须消费响应体，流才会真的走完

    await vi.waitFor(() => {
      expect(store.findAssessment(assessmentId, meId(store))?.interpretation)
        .toBe('你现在的位置是大一。')
    })
  })

  it('流中途出错时绝不写入半截解读', async () => {
    const brokenMidStream = new MockLanguageModelV3({
      doStream: async () => ({
        stream: simulateReadableStream({
          chunks: [
            { type: 'text-start', id: '1' },
            { type: 'text-delta', id: '1', delta: '前半句' },
            { type: 'error', error: new Error('模型中途断开') },
          ],
        }),
      }) as never,
    })

    const store = openStore(':memory:')
    const { app, cookie } = await authedApp(bundle, { model: brokenMidStream, store })
    const assessmentId = await diagnoseOnce(app, cookie)

    const res = await post(app, '/api/interpret',
      { assessmentId, pathId: 'same-discipline-baoyan' }, cookie)
    await res.text().catch(() => undefined) // 出错流可能直接断，容忍

    // 给异步写入足够的窗口：若实现是错的，这 100ms 里必然已经写进去了
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(store.findAssessment(assessmentId, meId(store))?.interpretation).toBeNull()
  })
})

describe('POST /api/chat', () => {
  it('返回流式回答', async () => {
    const { app, cookie } = await authedApp(bundle, { model: mockModel('保研与考研的时间窗不同。') })
    const assessmentId = await diagnoseOnce(app, cookie)
    const res = await post(app, '/api/chat', {
      assessmentId, pathId: 'same-discipline-baoyan',
      messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: '保研和考研怎么选？' }] }],
    }, cookie)
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('保研与考研的时间窗不同。')
  })

  it('把学生的问题真正送进模型（验证 UI 消息 → 模型消息的转换）', async () => {
    const model = new MockLanguageModelV3({
      doStream: async () => ({
        stream: simulateReadableStream({
          chunks: [
            { type: 'text-start', id: '1' },
            { type: 'text-delta', id: '1', delta: '好' },
            { type: 'text-end', id: '1' },
            {
              type: 'finish',
              finishReason: { unified: 'stop', raw: undefined },
              usage: {
                inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
                outputTokens: { total: 1, text: 1, reasoning: undefined },
              },
            },
          ],
        }),
      }),
    })

    const { app, cookie } = await authedApp(bundle, { model })
    const assessmentId = await diagnoseOnce(app, cookie)
    const res = await post(app, '/api/chat', {
      assessmentId, pathId: 'same-discipline-baoyan',
      messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: '保研和考研怎么选？' }] }],
    }, cookie)
    // 必须消费流式响应体，模型才会真正被调用
    await res.text()

    expect(JSON.stringify(model.doStreamCalls[0]!.prompt)).toContain('保研和考研怎么选？')
  })

  it('只保留最近 20 条消息，更早的不进模型（§8.5「最近 N 轮对话」）', async () => {
    const model = mockModel('好')
    const many = Array.from({ length: 25 }, (_, i) => ({
      id: `m${i}`, role: 'user', parts: [{ type: 'text', text: `第${i + 1}问` }],
    }))

    const { app, cookie } = await authedApp(bundle, { model })
    const assessmentId = await diagnoseOnce(app, cookie)
    const res = await post(app, '/api/chat', {
      assessmentId, pathId: 'same-discipline-baoyan', messages: many,
    }, cookie)
    await res.text()

    const prompt = JSON.stringify(model.doStreamCalls[0]!.prompt)
    expect(prompt).not.toContain('第1问')
    expect(prompt).toContain('第25问')
  })

  it('追问内容超过字符上限时返回 400，不把超大请求送进模型', async () => {
    const { app, cookie } = await authedApp(bundle, { model: mockModel('不该出现') })
    const assessmentId = await diagnoseOnce(app, cookie)
    const res = await post(app, '/api/chat', {
      assessmentId, pathId: 'same-discipline-baoyan',
      messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'x'.repeat(9000) }] }],
    }, cookie)
    expect(res.status).toBe(400)
  })

  it('messages 为空时返回 400', async () => {
    const { app, cookie } = await authedApp(bundle, { model: mockModel('不该出现') })
    const assessmentId = await diagnoseOnce(app, cookie)
    const res = await post(app, '/api/chat', {
      assessmentId, pathId: 'same-discipline-baoyan', messages: [],
    }, cookie)
    expect(res.status).toBe(400)
  })
})

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
  common: [],
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
  options: {
    model?: LanguageModel
    jwtSecret?: string
    store?: Store
    /** 在同一个 store 上建第二个用户时必须换名字——重名会让注册 409、拿不到 cookie */
    username?: string
  } = {},
) {
  const { username = 'tester', store: injected, ...rest } = options
  const store = injected ?? openStore(':memory:')
  const app = createApp(b, { jwtSecret: 'test-secret', ...rest, store })
  const res = await app.request('/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: 'pw123456' }),
  })
  const cookie = res.headers.get('set-cookie')!.split(';')[0]!
  const userId = store.verifyUser(username, 'pw123456')!.id
  return { app, cookie, store, userId }
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

describe('GET /api/meta', () => {
  it('返回画像原型与指标定义，供结果页画像叙事与雷达轴使用', async () => {
    const res = await createApp(bundle).request('/api/meta')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      archetypes: bundle.archetypes,
      indicators: bundle.indicators,
    })
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
    const { app, cookie, userId } = await authedApp(bundle, { store })
    const res = await post(app, '/api/diagnose', { answers: okAnswers }, cookie)
    const body = (await res.json()) as { assessmentId: string }
    expect(body.assessmentId).toBeTruthy()

    await post(app, '/api/diagnose', { answers: okAnswers }, cookie)
    expect(store.listAssessments(userId)).toHaveLength(2)
  })

  it('source 落库正确；缺省为 self，非法值 400', async () => {
    const store = openStore(':memory:')
    const { app, cookie, userId } = await authedApp(bundle, { store })

    await post(app, '/api/diagnose', { answers: okAnswers }, cookie)
    await post(app, '/api/diagnose', { answers: okAnswers, source: 'other' }, cookie)
    expect(store.listAssessments(userId).map(r => r.source).sort()).toEqual(['other', 'self'])

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

  it('解读的上下文里带上历次自我测评（「你的变化」段要有东西可讲）', async () => {
    const model = mockModel('解读正文')
    const store = openStore(':memory:')
    const { app, cookie } = await authedApp(bundle, { model, store })

    // 先做一次，让第二次有历史可比
    await diagnoseOnce(app, cookie)
    const second = await diagnoseOnce(app, cookie)

    const res = await post(app, '/api/interpret',
      { assessmentId: second, pathId: 'same-discipline-baoyan' }, cookie)
    await res.text()

    const prompt = JSON.stringify(model.doStreamCalls[0]!.prompt)
    // 断言上下文的**段落标题**而不是「历次自我测评」这个短语——后者在提示词正文里
    // 也有（「你的变化」段的说明提到它），拿它当判据两个方向都会假绿/假红
    expect(prompt).toContain('## 历次自我测评（最近数次，不含本次）')
  })

  it('第一次测评时上下文里没有历次段（「你的变化」段得照实说）', async () => {
    const model = mockModel('解读正文')
    const { app, cookie } = await authedApp(bundle, { model })
    const assessmentId = await diagnoseOnce(app, cookie)

    const res = await post(app, '/api/interpret',
      { assessmentId, pathId: 'same-discipline-baoyan' }, cookie)
    await res.text()

    expect(JSON.stringify(model.doStreamCalls[0]!.prompt)).not.toContain('## 历次自我测评')
  })

  it('在「测测别人」的记录上，不带账号主人自己的自我测评（混用方向反了）', async () => {
    const model = mockModel('解读正文')
    const store = openStore(':memory:')
    const { app, cookie } = await authedApp(bundle, { model, store })

    // 先测自己（留下 self 历史），再替别人测
    await diagnoseOnce(app, cookie)
    const theirs = await diagnoseOnce(app, cookie, {
      answers: okAnswers, grade: 'freshman', source: 'other',
    })

    const res = await post(app, '/api/interpret',
      { assessmentId: theirs, pathId: 'same-discipline-baoyan' }, cookie)
    await res.text()

    // 这段解读讲的是**被测量的那个人**，而它只有这一条记录。带上账号主人的历史，
    // 模型就会写「跟你上次比…」——拿你的画像解释别人（§4.2 第 4 条，方向反了）
    expect(JSON.stringify(model.doStreamCalls[0]!.prompt)).not.toContain('## 历次自我测评')
  })

  it('历史只含比当次更早的记录，不含更晚的', async () => {
    const model = mockModel('解读正文')
    const store = openStore(':memory:')
    const { app, cookie } = await authedApp(bundle, { model, store })

    const first = await diagnoseOnce(app, cookie)
    const second = await diagnoseOnce(app, cookie)

    // 看第二条：第一条更早，应当出现
    await (await post(app, '/api/interpret',
      { assessmentId: second, pathId: 'same-discipline-baoyan' }, cookie)).text()
    expect(JSON.stringify(model.doStreamCalls[0]!.prompt)).toContain('## 历次自我测评')

    // 看第一条：第二条更晚，不该出现——否则「你的变化」方向会讲反
    await (await post(app, '/api/interpret',
      { assessmentId: first, pathId: 'same-discipline-baoyan' }, cookie)).text()
    expect(JSON.stringify(model.doStreamCalls[1]!.prompt)).not.toContain('## 历次自我测评')
  })

  it('在「测测别人」的记录上追问，上下文不含账号主人自己的对话轮次', async () => {
    const model = mockModel('回答')
    const store = openStore(':memory:')
    const { app, cookie } = await authedApp(bundle, { model, store })

    const mine = await diagnoseOnce(app, cookie)
    await (await post(app, '/api/chat', {
      assessmentId: mine, pathId: 'same-discipline-baoyan', question: '关于我自己的问题',
    }, cookie)).text()
    await vi.waitFor(() => expect(model.doStreamCalls.length).toBe(1))

    const theirs = await diagnoseOnce(app, cookie, {
      answers: okAnswers, grade: 'freshman', source: 'other',
    })
    const res = await post(app, '/api/chat', {
      assessmentId: theirs, pathId: 'same-discipline-baoyan', question: '关于朋友的问题',
    }, cookie)
    await res.text()

    const prompt = JSON.stringify(model.doStreamCalls[1]!.prompt)
    expect(prompt).toContain('关于朋友的问题')
    expect(prompt).not.toContain('关于我自己的问题')
  })

  it('测测别人的记录不进历次自我测评（来源过滤）', async () => {
    const model = mockModel('解读正文')
    const store = openStore(':memory:')
    const { app, cookie } = await authedApp(bundle, { model, store })

    // 先替别人测一次，再测自己
    await post(app, '/api/diagnose', { answers: okAnswers, grade: 'freshman', source: 'other' }, cookie)
    const mine = await diagnoseOnce(app, cookie)

    const res = await post(app, '/api/interpret',
      { assessmentId: mine, pathId: 'same-discipline-baoyan' }, cookie)
    await res.text()

    expect(JSON.stringify(model.doStreamCalls[0]!.prompt)).not.toContain('## 历次自我测评')
  })

  it('流正常结束后，解读全文写入该记录', async () => {
    const store = openStore(':memory:')
    const { app, cookie, userId } = await authedApp(bundle, {
      model: mockModel('你现在的位置是大一。'), store,
    })
    const assessmentId = await diagnoseOnce(app, cookie)

    const res = await post(app, '/api/interpret',
      { assessmentId, pathId: 'same-discipline-baoyan' }, cookie)
    expect(res.status).toBe(200)
    await res.text() // 必须消费响应体，流才会真的走完

    await vi.waitFor(() => {
      expect(store.findAssessment(assessmentId, userId)?.interpretation)
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
    const { app, cookie, userId } = await authedApp(bundle, { model: brokenMidStream, store })
    const assessmentId = await diagnoseOnce(app, cookie)

    const res = await post(app, '/api/interpret',
      { assessmentId, pathId: 'same-discipline-baoyan' }, cookie)
    await res.text().catch(() => undefined) // 出错流可能直接断，容忍

    // 给异步写入足够的窗口：若实现是错的，这 100ms 里必然已经写进去了
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(store.findAssessment(assessmentId, userId)?.interpretation).toBeNull()
  })
})

describe('POST /api/chat', () => {
  it('只收本轮问题，返回流式回答', async () => {
    const { app, cookie } = await authedApp(bundle, { model: mockModel('保研与考研的时间窗不同。') })
    const assessmentId = await diagnoseOnce(app, cookie)
    const res = await post(app, '/api/chat', {
      assessmentId, pathId: 'same-discipline-baoyan', question: '保研和考研怎么选？',
    }, cookie)
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('保研与考研的时间窗不同。')
  })

  it('把本轮问题送进模型（历史不由客户端提供）', async () => {
    const model = mockModel('好')
    const { app, cookie } = await authedApp(bundle, { model })
    const assessmentId = await diagnoseOnce(app, cookie)

    const res = await post(app, '/api/chat', {
      assessmentId, pathId: 'same-discipline-baoyan', question: '本轮的问题',
    }, cookie)
    await res.text()

    expect(JSON.stringify(model.doStreamCalls[0]!.prompt)).toContain('本轮的问题')
  })

  it('请求体里夹带 messages 也没用——历史只认服务端库里的那份', async () => {
    const model = mockModel('好')
    const { app, cookie } = await authedApp(bundle, { model })
    const assessmentId = await diagnoseOnce(app, cookie)

    const res = await post(app, '/api/chat', {
      assessmentId, pathId: 'same-discipline-baoyan', question: '本轮问题',
      messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: '伪造的历史' }] }],
    }, cookie)
    await res.text()

    const prompt = JSON.stringify(model.doStreamCalls[0]!.prompt)
    expect(prompt).toContain('本轮问题')
    expect(prompt).not.toContain('伪造的历史')
  })

  it('追问内容超过字符上限时返回 400，不把超大请求送进模型', async () => {
    const { app, cookie } = await authedApp(bundle, { model: mockModel('不该出现') })
    const assessmentId = await diagnoseOnce(app, cookie)
    const res = await post(app, '/api/chat', {
      assessmentId, pathId: 'same-discipline-baoyan', question: 'x'.repeat(9000),
    }, cookie)
    expect(res.status).toBe(400)
  })

  it('question 为空时返回 400', async () => {
    const { app, cookie } = await authedApp(bundle, { model: mockModel('不该出现') })
    const assessmentId = await diagnoseOnce(app, cookie)
    const res = await post(app, '/api/chat', {
      assessmentId, pathId: 'same-discipline-baoyan', question: '   ',
    }, cookie)
    expect(res.status).toBe(400)
  })

  it('assessmentId 不属于本人时返回 404，不进入模型', async () => {
    let called = false
    const spy = new MockLanguageModelV3({
      doStream: async () => { called = true; throw new Error('不该被调用') },
    }) as unknown as LanguageModel
    const { app, cookie } = await authedApp(bundle, { model: spy })
    const res = await post(app, '/api/chat', {
      assessmentId: 'not-exist', pathId: 'same-discipline-baoyan', question: '问题',
    }, cookie)
    expect(res.status).toBe(404)
    expect(called).toBe(false)
  })

  it('未带会话 cookie 时返回 401', async () => {
    const { app } = await authedApp()
    const res = await post(app, '/api/chat', {
      assessmentId: 'x', pathId: 'same-discipline-baoyan', question: '问题',
    })
    expect(res.status).toBe(401)
  })
})

describe('POST /api/chat · 对话落库与上下文（专项 §11.3、§11.4）', () => {
  it('一轮问答在流正常结束后成对写入', async () => {
    const store = openStore(':memory:')
    const { app, cookie, userId } = await authedApp(bundle, { model: mockModel('回答正文'), store })
    const assessmentId = await diagnoseOnce(app, cookie)

    const res = await post(app, '/api/chat', {
      assessmentId, pathId: 'same-discipline-baoyan', question: '问题正文',
    }, cookie)
    await res.text()

    await vi.waitFor(() => {
      const turns = store.recentTurns(userId, { id: assessmentId, source: 'self' }, 20)
      expect(turns.map(t => t.content)).toEqual(['问题正文', '回答正文'])
    })
  })

  it('流中途出错时一轮都不写（半截回答不能成为后续上下文的既定事实）', async () => {
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
    const { app, cookie, userId } = await authedApp(bundle, { model: brokenMidStream, store })
    const assessmentId = await diagnoseOnce(app, cookie)

    const res = await post(app, '/api/chat', {
      assessmentId, pathId: 'same-discipline-baoyan', question: '会失败的问题',
    }, cookie)
    await res.text().catch(() => undefined)

    await new Promise(resolve => setTimeout(resolve, 100))
    expect(store.recentTurns(userId, { id: assessmentId, source: 'self' }, 20)).toEqual([])
  })

  it('第二轮追问带上第一轮的回答（账号级流是连续的）', async () => {
    const model = mockModel('第一轮的回答')
    const store = openStore(':memory:')
    const { app, cookie } = await authedApp(bundle, { model, store })
    const assessmentId = await diagnoseOnce(app, cookie)

    const first = await post(app, '/api/chat', {
      assessmentId, pathId: 'same-discipline-baoyan', question: '第一轮的问题',
    }, cookie)
    await first.text()
    await vi.waitFor(() => expect(model.doStreamCalls.length).toBe(1))

    const second = await post(app, '/api/chat', {
      assessmentId, pathId: 'same-discipline-baoyan', question: '第二轮的问题',
    }, cookie)
    await second.text()

    const prompt = JSON.stringify(model.doStreamCalls[1]!.prompt)
    expect(prompt).toContain('第一轮的问题')
    expect(prompt).toContain('第一轮的回答')
    expect(prompt).toContain('第二轮的问题')
  })

  it('换路径追问时上文仍在（路径不影响过滤）', async () => {
    // 要测「换路径」就得有两条真实存在的路径——pathId 必须在这条记录的 result 里，
    // 否则会被 pathIdInRecord 正确地挡成 404
    const twoPathBundle: KnowledgeBundle = {
      ...bundle,
      paths: [
        ...bundle.paths,
        {
          id: 'second-path', title: '第二条路径', category: 'academic',
          span: 'same-discipline', status: 'verified', summary: '',
          weights: [], eligibility: [],
        },
      ],
    }
    const model = mockModel('回答')
    const store = openStore(':memory:')
    const { app, cookie } = await authedApp(twoPathBundle, { model, store })
    const assessmentId = await diagnoseOnce(app, cookie)

    const first = await post(app, '/api/chat', {
      assessmentId, pathId: 'same-discipline-baoyan', question: '在保研页问的',
    }, cookie)
    await first.text()
    await vi.waitFor(() => expect(model.doStreamCalls.length).toBe(1))

    const second = await post(app, '/api/chat', {
      assessmentId, pathId: 'second-path', question: '换页后问的',
    }, cookie)
    expect(second.status).toBe(200)
    await second.text()

    expect(JSON.stringify(model.doStreamCalls[1]!.prompt)).toContain('在保研页问的')
  })
})

describe('GET /api/chat/history', () => {
  it('返回本人的对话轮次，按时间正序', async () => {
    const store = openStore(':memory:')
    const { app, cookie, userId } = await authedApp(bundle, { model: mockModel('回答'), store })
    const assessmentId = await diagnoseOnce(app, cookie)
    await (await post(app, '/api/chat', {
      assessmentId, pathId: 'same-discipline-baoyan', question: '问题',
    }, cookie)).text()

    await vi.waitFor(() => expect(store.recentTurns(userId, { id: assessmentId, source: 'self' }, 20)).toHaveLength(2))

    const res = await app.request('/api/chat/history', { headers: { cookie } })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { turns: Array<{ role: string; content: string }> }
    expect(body.turns.map(t => t.role)).toEqual(['user', 'assistant'])
    expect(body.turns[0]!.content).toBe('问题')
  })

  it('带 assessmentId 时返回那条记录自己的轮次（含 other 的）', async () => {
    const store = openStore(':memory:')
    const { app, cookie, userId } = await authedApp(bundle, { model: mockModel('回答'), store })
    const mine = await diagnoseOnce(app, cookie)
    await (await post(app, '/api/chat', {
      assessmentId: mine, pathId: 'same-discipline-baoyan', question: '我自己的问题',
    }, cookie)).text()

    const theirs = await diagnoseOnce(app, cookie, {
      answers: okAnswers, grade: 'freshman', source: 'other',
    })
    await (await post(app, '/api/chat', {
      assessmentId: theirs, pathId: 'same-discipline-baoyan', question: '朋友的问题',
    }, cookie)).text()
    // 等两轮都写完：锚点用 other 那条，它只含自己的轮次
    await vi.waitFor(() => expect(
      store.recentTurns(userId, { id: theirs, source: 'other' }, 20),
    ).toHaveLength(2))

    // 不带锚点：只看得到自己那条
    const plain = await app.request('/api/chat/history', { headers: { cookie } })
    const plainBody = (await plain.json()) as { turns: Array<{ content: string }> }
    expect(plainBody.turns.map(t => t.content)).toEqual(['我自己的问题', '回答'])

    // 带 other 记录的锚点：那条记录自己的轮次也在——界面与模型看到的是同一份
    const anchored = await app.request(`/api/chat/history?assessmentId=${theirs}`,
      { headers: { cookie } })
    const anchoredBody = (await anchored.json()) as { turns: Array<{ content: string }> }
    expect(anchoredBody.turns.map(t => t.content)).toEqual(['朋友的问题', '回答'])
  })

  it('不带会话 cookie 返回 401', async () => {
    const { app } = await authedApp()
    expect((await app.request('/api/chat/history')).status).toBe(401)
  })
})

describe('GET /api/assessments（历史）', () => {
  it('列出本人的历次测评，含主推荐路径、标题与匹配度', async () => {
    const { app, cookie } = await authedApp()
    await post(app, '/api/diagnose', { answers: okAnswers, grade: 'freshman', source: 'other' }, cookie)

    const res = await app.request('/api/assessments', { headers: { cookie } })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      assessments: Array<{
        source: string; mainPathId: string; mainPathTitle: string
        match: number; grade: string
      }>
    }
    expect(body.assessments).toHaveLength(1)
    expect(body.assessments[0]!.source).toBe('other')
    expect(body.assessments[0]!.mainPathId).toBe('same-discipline-baoyan')
    // 列表要显示中文路径名；服务端手里有 bundle，不必让前端再取一次 /api/questions
    expect(body.assessments[0]!.mainPathTitle).toBe('本学科保研')
    expect(body.assessments[0]!.grade).toBe('freshman')
    expect(typeof body.assessments[0]!.match).toBe('number')
  })

  it('不带会话 cookie 返回 401', async () => {
    const { app } = await authedApp()
    expect((await app.request('/api/assessments')).status).toBe(401)
  })

  it('只看得到本人的记录', async () => {
    const store = openStore(':memory:')
    const alice = await authedApp(bundle, { store, username: 'alice' })
    const bob = await authedApp(bundle, { store, username: 'bob' })
    await post(alice.app, '/api/diagnose', { answers: okAnswers }, alice.cookie)

    const res = await bob.app.request('/api/assessments', { headers: { cookie: bob.cookie } })
    expect(((await res.json()) as { assessments: unknown[] }).assessments).toHaveLength(0)
  })
})

describe('GET /api/assessments · 画像名', () => {
  it('列表行带上主原型的中文名', async () => {
    const { app, cookie } = await authedApp()
    await diagnoseOnce(app, cookie)
    const res = await app.request('/api/assessments', { headers: { cookie } })
    const body = await res.json() as { assessments: Array<{ archetypeName: string | null }> }
    expect(body.assessments[0]!.archetypeName).toBe('稳健学术型')
  })
})

describe('GET /api/assessments/:id（单条完整）', () => {
  it('返回完整记录、路径摘要、主推荐路径与并列路径，以及可空的解读', async () => {
    const { app, cookie } = await authedApp()
    const assessmentId = await diagnoseOnce(app, cookie)

    const res = await app.request(`/api/assessments/${assessmentId}`, { headers: { cookie } })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      answers: Record<string, number>; interpretation: string | null
      paths: Array<{ id: string }>; mainPathId: string; tiedPaths: string[]
    }
    expect(body.answers).toEqual(okAnswers)
    expect(body.interpretation).toBeNull()
    expect(body.paths[0]!.id).toBe('same-discipline-baoyan')
    expect(body.mainPathId).toBe('same-discipline-baoyan')
    expect(body.tiedPaths).toEqual(['same-discipline-baoyan'])
  })

  it('解读生成后能从这条接口取回', async () => {
    const store = openStore(':memory:')
    const { app, cookie } = await authedApp(bundle, { model: mockModel('解读全文'), store })
    const assessmentId = await diagnoseOnce(app, cookie)
    const streamed = await post(app, '/api/interpret',
      { assessmentId, pathId: 'same-discipline-baoyan' }, cookie)
    await streamed.text()

    await vi.waitFor(async () => {
      const res = await app.request(`/api/assessments/${assessmentId}`, { headers: { cookie } })
      const body = (await res.json()) as { interpretation: string | null }
      expect(body.interpretation).toBe('解读全文')
    })
  })

  it('他人的 id 与不存在的 id 都返回 404', async () => {
    const store = openStore(':memory:')
    const alice = await authedApp(bundle, { store, username: 'alice' })
    const bob = await authedApp(bundle, { store, username: 'bob' })
    const id = await diagnoseOnce(alice.app, alice.cookie)

    expect((await bob.app.request(
      `/api/assessments/${id}`, { headers: { cookie: bob.cookie } })).status).toBe(404)
    expect((await bob.app.request(
      '/api/assessments/nope', { headers: { cookie: bob.cookie } })).status).toBe(404)
  })

  it('库里某行 result 形状不对时列表跳过坏行，其余照常返回（不 500）', async () => {
    const { app, cookie, store, userId } = await authedApp()
    const good = await diagnoseOnce(app, cookie)
    // 合法 JSON 但没有 paths：旧 schema 残留的真实形态，JSON.parse 拦不住它
    store.createAssessment({ userId, source: 'self', grade: null, answers: {}, result: {} as never })

    const res = await app.request('/api/assessments', { headers: { cookie } })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { assessments: Array<{ id: string }> }
    expect(body.assessments.map(a => a.id)).toEqual([good])
  })

  it('result 有 paths 但元素缺 eligibility 时也跳过，不把列表打成 500', async () => {
    const { app, cookie, store, userId } = await authedApp()
    const good = await diagnoseOnce(app, cookie)
    // 字段改名 / 旧 schema 残留的典型形态：paths 在、eligibility 不在。
    // 只判 Array.isArray(paths) 的守卫会放行它，随后 findTiedPaths 读
    // p.eligibility.applicable 时抛 TypeError，把整个历史列表打成 500。
    store.createAssessment({
      userId, source: 'self', grade: null, answers: {},
      result: { paths: [{ id: 'x' }] } as never,
    })

    const res = await app.request('/api/assessments', { headers: { cookie } })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { assessments: Array<{ id: string }> }
    expect(body.assessments.map(a => a.id)).toEqual([good])
  })
})

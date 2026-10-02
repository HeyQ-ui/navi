import { describe, it, expect } from 'vitest'
import { simulateReadableStream } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'
import type { LanguageModel } from 'ai'
import { createApp } from './server.js'
import type { KnowledgeBundle } from '@navi/core'

/** 会说固定话的 mock 模型；形状与 packages/llm 的冒烟测试一致 */
function mockModel(text: string): LanguageModel {
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
})

describe('POST /api/diagnose', () => {
  it('返回结构化诊断结果', async () => {
    const res = await createApp(bundle).request('/api/diagnose', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ answers: { q1: 4, q2: 4, q3: 4 } }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      paths: Array<{ id: string }>
      indicators: Record<string, { known: boolean }>
    }
    expect(body.paths[0]!.id).toBe('same-discipline-baoyan')
    expect(body.indicators['academic-interest']!.known).toBe(true)
  })

  it('响应中不含任何模型生成内容', async () => {
    const res = await createApp(bundle).request('/api/diagnose', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ answers: { q1: 4, q2: 4, q3: 4 } }),
    })
    const body = (await res.json()) as Record<string, unknown>
    expect(body).not.toHaveProperty('interpretation')
    expect(body).not.toHaveProperty('text')
  })

  it('请求体缺少 answers 时返回 400', async () => {
    const res = await createApp(bundle).request('/api/diagnose', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
  })

  it('answers 不是对象时返回 400 而不是 500', async () => {
    const res = await createApp(bundle).request('/api/diagnose', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ answers: 'nonsense' }),
    })
    expect(res.status).toBe(400)
  })

  it('请求体不是合法 JSON 时返回 400', async () => {
    const res = await createApp(bundle).request('/api/diagnose', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    })
    expect(res.status).toBe(400)
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
    const res = await createApp(gradedBundle).request('/api/diagnose', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ grade: 'freshman', answers: { 'common-1': 4, 'fresh-1': 4, 'senior-1': 0 } }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { indicators: Record<string, { sources: string[] }> }
    expect(body.indicators['academic-interest']!.sources).not.toContain('senior-1')
  })
})

describe('答案完整性与接近路径（设计文档 §5.5、§10）', () => {
  it('答案不完整时返回 400，而不是静默用部分题目计分', async () => {
    const res = await createApp(bundle).request('/api/diagnose', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ answers: { q1: 4 } }),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('q2')
  })

  it('响应中给出分数接近的路径 id 列表', async () => {
    const res = await createApp(bundle).request('/api/diagnose', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ answers: { q1: 4, q2: 4, q3: 4 } }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { closeMatches: string[] }
    expect(body.closeMatches).toEqual(['same-discipline-baoyan'])
  })
})

const okAnswers = { q1: 4, q2: 4, q3: 4 }

function post(app: ReturnType<typeof createApp>, path: string, body: unknown) {
  return app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/interpret', () => {
  it('返回流式解读文本', async () => {
    const app = createApp(bundle, { model: mockModel('你现在的位置是大一。') })
    const res = await post(app, '/api/interpret', {
      answers: okAnswers, grade: 'freshman', pathId: 'same-discipline-baoyan',
    })
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('你现在的位置是大一。')
  })

  it('pathId 不存在时返回 404，不进入模型', async () => {
    let called = false
    const spy = new MockLanguageModelV3({
      doStream: async () => { called = true; throw new Error('不该被调用') },
    }) as unknown as LanguageModel
    const app = createApp(bundle, { model: spy })
    const res = await post(app, '/api/interpret', {
      answers: okAnswers, grade: 'freshman', pathId: 'not-exist',
    })
    expect(res.status).toBe(404)
    expect(called).toBe(false)
  })

  it('答案不完整时返回 400，不进入模型', async () => {
    const app = createApp(bundle, { model: mockModel('不该出现') })
    const res = await post(app, '/api/interpret', {
      answers: { q1: 4 }, grade: 'freshman', pathId: 'same-discipline-baoyan',
    })
    expect(res.status).toBe(400)
  })

  it('未配置 API Key 且没有注入模型时返回 503，而不是 500', async () => {
    const saved = process.env.DEEPSEEK_API_KEY
    delete process.env.DEEPSEEK_API_KEY
    try {
      const res = await post(createApp(bundle), '/api/interpret', {
        answers: okAnswers, grade: 'freshman', pathId: 'same-discipline-baoyan',
      })
      expect(res.status).toBe(503)
    } finally {
      if (saved !== undefined) process.env.DEEPSEEK_API_KEY = saved
    }
  })
})

describe('POST /api/chat', () => {
  it('返回流式回答', async () => {
    const app = createApp(bundle, { model: mockModel('保研与考研的时间窗不同。') })
    const res = await post(app, '/api/chat', {
      answers: okAnswers, grade: 'freshman', pathId: 'same-discipline-baoyan',
      messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: '保研和考研怎么选？' }] }],
    })
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

    const res = await post(createApp(bundle, { model }), '/api/chat', {
      answers: okAnswers, grade: 'freshman', pathId: 'same-discipline-baoyan',
      messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: '保研和考研怎么选？' }] }],
    })
    // 必须消费流式响应体，模型才会真正被调用
    await res.text()

    expect(JSON.stringify(model.doStreamCalls[0]!.prompt)).toContain('保研和考研怎么选？')
  })

  it('messages 为空时返回 400', async () => {
    const app = createApp(bundle, { model: mockModel('不该出现') })
    const res = await post(app, '/api/chat', {
      answers: okAnswers, grade: 'freshman', pathId: 'same-discipline-baoyan', messages: [],
    })
    expect(res.status).toBe(400)
  })
})

import { describe, it, expect } from 'vitest'
import { simulateReadableStream } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'
import { diagnose } from '@navi/core'
import { streamInterpret, streamChat, createDeepSeekModel } from './index.js'
import type { Answers, KnowledgeBundle } from '@navi/core'

const bundle: KnowledgeBundle = {
  indicators: [{ id: 'academic-interest', name: '学术志趣' }],
  questions: [
    { id: 'q1', indicator: 'academic-interest', text: 'q1', options: ['a','b','c','d','e'], weight: 1 },
    { id: 'q2', indicator: 'academic-interest', text: 'q2', options: ['a','b','c','d','e'], weight: 1 },
    { id: 'q3', indicator: 'academic-interest', text: 'q3', options: ['a','b','c','d','e'], weight: 1 },
  ],
  archetypes: [],
  paths: [
    {
      id: 'same-discipline-baoyan', title: '本学科保研', category: 'academic',
      span: 'same-discipline', status: 'draft', summary: '保研是用绩点换免试资格。',
      weights: [{ indicator: 'academic-interest', weight: 1, ideal: 90 }], eligibility: [],
    },
  ],
  blocks: {
    'same-discipline-baoyan': [{ type: 'timeline', html: '<p>夏令营</p>', raw: '大三下夏令营' }],
  },
  boundaries: [],
}

const answers: Answers = { q1: 4, q2: 4, q3: 4 }

/** 造一个会说固定话的 mock 模型。返回具体类型，便于断言调用记录 */
function mockModel(text = '解读正文'): MockLanguageModelV3 {
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

describe('streamInterpret', () => {
  it('产出模型返回的解读正文', async () => {
    const result = streamInterpret(
      { answers, pathId: 'same-discipline-baoyan', bundle },
      { model: mockModel('你现在大一，保研是最紧的一条路。') },
    )
    expect(await result.text).toBe('你现在大一，保研是最紧的一条路。')
  })

  it('发给模型的系统提示词同时含防幻觉约束与知识正文', async () => {
    const model = mockModel()
    await streamInterpret(
      { answers, pathId: 'same-discipline-baoyan', bundle },
      { model },
    ).text

    const call = model.doStreamCalls[0]!
    const serialized = JSON.stringify(call.prompt)
    expect(serialized).toContain('只能')
    expect(serialized).toContain('<knowledge>')
    expect(serialized).toContain('大三下夏令营')
  })

  it('传入预置 result 时上下文用它，不重算（快照与页面显示一致）', async () => {
    const model = mockModel()
    // 造一份与重算结果必然不同的快照：把匹配度改成一个明显是伪造的值
    const snapshot = diagnose(answers, bundle)
    const tampered = {
      ...snapshot,
      paths: snapshot.paths.map(p => ({ ...p, match: 12 })),
    }

    await streamInterpret(
      { answers, pathId: 'same-discipline-baoyan', bundle, result: tampered },
      { model },
    ).text

    // 知识库会在测评记录存续期间被重建，而 bundle 在进程启动时读一次。
    // 若上下文重算，用户会看到页面写着 55、模型却解释 62。
    expect(JSON.stringify(model.doStreamCalls[0]!.prompt)).toContain('匹配度 12')
  })
})

describe('streamChat', () => {
  it('把对话历史与知识一起发给模型', async () => {
    const model = mockModel('两条路的时间窗不同。')
    const result = streamChat(
      {
        answers, pathId: 'same-discipline-baoyan', bundle,
        messages: [{ role: 'user', content: '保研和考研怎么选？' }],
      },
      { model },
    )
    expect(await result.text).toBe('两条路的时间窗不同。')

    expect(JSON.stringify(model.doStreamCalls[0]!.prompt)).toContain('保研和考研怎么选？')
  })
})

describe('createDeepSeekModel', () => {
  it('未配置 API Key 时抛错', () => {
    expect(() => createDeepSeekModel({})).toThrow()
  })

  it('空字符串的 baseURL 与 model 回落到默认值', () => {
    // .env.example 里这两项是留空的，loadEnvFile 会把它们设成空串。
    // 若用 ?? 兜底，空串会穿透，baseURL 与 modelId 双双变成空字符串。
    const model = createDeepSeekModel({
      DEEPSEEK_API_KEY: 'k',
      DEEPSEEK_BASE_URL: '',
      DEEPSEEK_MODEL: '',
    })
    // LanguageModel 是联合类型（含字符串形式的模型 id），这里断言的是 provider.chat 收到过什么
    expect((model as { modelId: string }).modelId).toBe('deepseek-chat')
  })
})

describe('降级', () => {
  it('模型调用失败时抛出可捕获的错误，不吞掉', async () => {
    const broken = new MockLanguageModelV3({
      doStream: async () => { throw new Error('模型欠费') },
    })

    await expect(
      streamInterpret(
        { answers, pathId: 'same-discipline-baoyan', bundle },
        { model: broken },
      // .text 触发实际调用；失败必须能冒泡到调用方，由 API 层转成降级响应
      ).text,
    ).rejects.toThrow()
  })

  it('【已知缺陷】流中途出错时 text 静默返回已累积的部分文本', async () => {
    // 这不是期望行为，是把当前行为钉住：超时/欠费发生在首 token 之后时，
    // .text 会 resolve 出半截文本，错误既不抛给调用方，也不进纯文本流，
    // 客户端因此拿不到任何降级信号。详见 PROJECT_STATE §8.6。
    // 将来把 /api/interpret 换成 UI 消息流（错误会进流）时，这条会主动变红，
    // 提醒改的人连同断言一起更新。
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

    const result = streamInterpret(
      { answers, pathId: 'same-discipline-baoyan', bundle },
      { model: brokenMidStream },
    )
    expect(await result.text).toBe('前半句')
  })
})

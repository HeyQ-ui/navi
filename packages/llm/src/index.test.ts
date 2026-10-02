import { describe, it, expect } from 'vitest'
import { simulateReadableStream } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'
import { streamInterpret, streamChat } from './index.js'
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
      { answers, grade: 'freshman', pathId: 'same-discipline-baoyan', bundle },
      { model: mockModel('你现在大一，保研是最紧的一条路。') },
    )
    expect(await result.text).toBe('你现在大一，保研是最紧的一条路。')
  })

  it('发给模型的系统提示词同时含防幻觉约束与知识正文', async () => {
    const model = mockModel()
    await streamInterpret(
      { answers, grade: 'freshman', pathId: 'same-discipline-baoyan', bundle },
      { model },
    ).text

    const call = model.doStreamCalls[0]!
    const serialized = JSON.stringify(call.prompt)
    expect(serialized).toContain('只能')
    expect(serialized).toContain('<knowledge>')
    expect(serialized).toContain('大三下夏令营')
  })
})

describe('streamChat', () => {
  it('把对话历史与知识一起发给模型', async () => {
    const model = mockModel('两条路的时间窗不同。')
    const result = streamChat(
      {
        answers, grade: 'freshman', pathId: 'same-discipline-baoyan', bundle,
        messages: [{ role: 'user', content: '保研和考研怎么选？' }],
      },
      { model },
    )
    expect(await result.text).toBe('两条路的时间窗不同。')

    expect(JSON.stringify(model.doStreamCalls[0]!.prompt)).toContain('保研和考研怎么选？')
  })
})

describe('降级', () => {
  it('模型调用失败时抛出可捕获的错误，不吞掉', async () => {
    const broken = new MockLanguageModelV3({
      doStream: async () => { throw new Error('模型欠费') },
    })

    await expect(
      streamInterpret(
        { answers, grade: 'freshman', pathId: 'same-discipline-baoyan', bundle },
        { model: broken },
      // .text 触发实际调用；失败必须能冒泡到调用方，由 API 层转成降级响应
      ).text,
    ).rejects.toThrow()
  })
})

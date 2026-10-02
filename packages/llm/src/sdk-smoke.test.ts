import { describe, it, expect } from 'vitest'
import { streamText, simulateReadableStream } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'

/**
 * 这个测试不验证我们的业务逻辑，它只回答一个问题：
 * 当前安装的 SDK 版本，用 mock 模型造一次流式响应，写法到底是什么样。
 * 后续所有测试都依赖这里确定下来的形状。
 */
describe('Vercel AI SDK 面确认', () => {
  it('用 mock 模型跑通一次流式调用', async () => {
    const result = streamText({
      model: new MockLanguageModelV3({
        doStream: async () => ({
          stream: simulateReadableStream({
            chunks: [
              { type: 'text-start', id: '1' },
              { type: 'text-delta', id: '1', delta: '你好' },
              { type: 'text-end', id: '1' },
              {
                type: 'finish',
                // v7 的 V3 规格：finishReason 与 usage 都是对象，不是裸值
                finishReason: { unified: 'stop', raw: undefined },
                usage: {
                  inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
                  outputTokens: { total: 1, text: 1, reasoning: undefined },
                },
              },
            ],
          }),
        }),
      }),
      prompt: 'test',
    })

    expect(await result.text).toBe('你好')
  })
})

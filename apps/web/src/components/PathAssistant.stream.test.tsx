import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PathAssistant } from './PathAssistant.js'

/**
 * 与 PathAssistant.test.tsx 的分工：
 * 那边把 @ai-sdk/react 整个 mock 掉，只验证渲染分支；`completion` 是直接喂进去的，
 * 因此看不见「客户端流协议与服务端响应格式对不上」这类只存在于接缝处的缺陷。
 * 这里保留真实 hook，只把 fetch 换掉，喂给它后端真正会返回的东西。
 */

/** /api/interpret 用 toTextStreamResponse()，响应体就是纯文本，没有 data: 事件行 */
function textResponse(text: string) {
  return {
    ok: true,
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(text))
        controller.close()
      },
    }),
  }
}

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body, text: async () => '' }
}

/**
 * 挂载时会并发打两个端点：解读是纯文本流，对话历史是 JSON。
 * 不按 URL 分支的话，历史那条会拿到纯文本、解析失败——虽然被组件里的 catch
 * 吞掉了，但那是侥幸通过，不是真的对。
 */
function stubFetchByUrl(interpretText: string) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/api/chat/history')) return jsonResponse({ turns: [] })
    return textResponse(interpretText)
  }))
}

const base = { assessmentId: 'a1' }

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('PathAssistant 与真实 useCompletion 的接缝', () => {
  it('把后端的纯文本流渲染成解读正文', async () => {
    stubFetchByUrl('保研是时间窗最紧的一条路。')

    render(<PathAssistant {...base} pathId="same-discipline-baoyan" />)

    expect(await screen.findByText('保研是时间窗最紧的一条路。')).toBeInTheDocument()
  })
})

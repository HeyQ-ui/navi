import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { InterpretSection } from './InterpretSection.js'

/** /api/interpret 用 toTextStreamResponse()，响应体就是纯文本 */
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

function stubFetchByUrl(interpretText: string) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/api/chat/history')) return jsonResponse({ turns: [] })
    return textResponse(interpretText)
  }))
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('InterpretSection 与真实 useCompletion 的接缝', () => {
  it('把后端的纯文本流渲染成解读正文', async () => {
    stubFetchByUrl('保研是时间窗最紧的一条路。')
    render(<InterpretSection assessmentId="a1" pathId="same-discipline-baoyan" />)
    expect(await screen.findByText(/保研是时间窗最紧的一条路/)).toBeInTheDocument()
  })

  it('流结束后把【可以问我】行解析成芯片，标记本身不进正文', async () => {
    stubFetchByUrl('解读正文。\n【可以问我】保研率大概多少？ | 大一该做什么？')
    render(<InterpretSection assessmentId="a1" pathId="same-discipline-baoyan" />)
    expect(await screen.findByRole('button', { name: '保研率大概多少？' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '大一该做什么？' })).toBeInTheDocument()
    expect(screen.queryByText(/【可以问我】/)).not.toBeInTheDocument()
  })
})

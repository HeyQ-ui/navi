import { describe, it, expect, vi, afterEach } from 'vitest'
import { postDiagnose, logout, fetchChatHistory, buildChatBody } from './api.js'

afterEach(() => { vi.restoreAllMocks() })

describe('postDiagnose', () => {
  it('把服务端的错误文案透出来，而不是只报状态码', async () => {
    // 题目没答全时服务端会指名哪几道题——那条信息对用户才有用
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: '以下题目未作答：q2, q3' }), { status: 400 }),
    )
    await expect(postDiagnose({ q1: 4 }, 'freshman', 'self'))
      .rejects.toThrow('以下题目未作答：q2, q3')
  })

  it('响应体不是 JSON 时退回状态码文案，不抛解析错误', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('not json', { status: 500 }))
    await expect(postDiagnose({ q1: 4 }, 'freshman', 'self')).rejects.toThrow('诊断失败：500')
  })
})

describe('logout', () => {
  it('非 2xx 时抛错，让调用方知道 cookie 可能没清掉', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 500 }))
    await expect(logout()).rejects.toThrow('登出失败：500')
  })

  it('2xx 时不抛错', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }))
    await expect(logout()).resolves.toBeUndefined()
  })
})

describe('fetchChatHistory', () => {
  it('把服务端的轮次转成 UI 消息', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      turns: [
        { id: 'm1', role: 'user', content: '保研和考研怎么选？', createdAt: '2026-01-01T00:00:00.000Z' },
        { id: 'm2', role: 'assistant', content: '时间窗不同。', createdAt: '2026-01-01T00:00:01.000Z' },
      ],
    }), { status: 200 }))

    const messages = await fetchChatHistory('a1')
    expect(messages).toHaveLength(2)
    expect(messages[0]!.role).toBe('user')
    expect(messages[0]!.parts).toEqual([{ type: 'text', text: '保研和考研怎么选？' }])
    // 必须把锚点带上：不带的话服务端只回 self 的轮次，与模型上下文口径不一致
    expect(vi.mocked(globalThis.fetch).mock.calls[0]![0]).toBe('/api/chat/history?assessmentId=a1')
  })
})

describe('buildChatBody', () => {
  it('只取最后一条用户消息作为本轮问题，不把整段历史发上去', () => {
    const body = buildChatBody({
      assessmentId: 'a1',
      pathId: 'p1',
      messages: [
        { id: 'm1', role: 'user', parts: [{ type: 'text', text: '第一轮' }] },
        { id: 'm2', role: 'assistant', parts: [{ type: 'text', text: '第一答' }] },
        { id: 'm3', role: 'user', parts: [{ type: 'text', text: '第二轮' }] },
      ],
    })

    expect(body).toEqual({ assessmentId: 'a1', pathId: 'p1', question: '第二轮' })
  })

  it('最后一条不是用户消息时，回退到最近的那条用户消息', () => {
    // 当前 UI 路径下末尾总是 user（sendMessage 先 push 用户消息），但这是隐式约定。
    // 不认 role 的话，任何「末尾是 assistant」的调用都会把回答当成新问题发上去。
    const body = buildChatBody({
      assessmentId: 'a1',
      pathId: 'p1',
      messages: [
        { id: 'm1', role: 'user', parts: [{ type: 'text', text: '我要问的' }] },
        { id: 'm2', role: 'assistant', parts: [{ type: 'text', text: '上一条回答' }] },
      ],
    })

    expect(body.question).toBe('我要问的')
  })

  it('把多段 part 拼成一段文本', () => {
    const body = buildChatBody({
      assessmentId: 'a1',
      pathId: 'p1',
      messages: [{ id: 'm1', role: 'user', parts: [
        { type: 'text', text: '前半' }, { type: 'text', text: '后半' },
      ] }],
    })
    expect(body.question).toBe('前半后半')
  })
})

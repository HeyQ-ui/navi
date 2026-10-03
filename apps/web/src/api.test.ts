import { describe, it, expect, vi, afterEach } from 'vitest'
import { postDiagnose, logout } from './api.js'

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

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@ai-sdk/react', () => ({
  useCompletion: vi.fn(),
  useChat: vi.fn(),
}))

import { useChat, useCompletion } from '@ai-sdk/react'
import { PathAssistant } from './PathAssistant.js'

/** 把两个 hook 的返回值设成想要的形状；只关心被测组件读取的字段 */
function stub(overrides: {
  completion?: string
  interpretError?: Error
  messages?: unknown[]
} = {}) {
  vi.mocked(useCompletion).mockReturnValue({
    completion: overrides.completion ?? '',
    complete: vi.fn(),
    isLoading: false,
    error: overrides.interpretError,
  } as never)
  vi.mocked(useChat).mockReturnValue({
    messages: overrides.messages ?? [],
    sendMessage: vi.fn(),
    status: 'ready',
    error: undefined,
  } as never)
}

const base = { assessmentId: 'a1' }

beforeEach(() => {
  vi.clearAllMocks()
  stub()
})

describe('PathAssistant', () => {
  it('渲染解读区与追问输入框', () => {
    render(<PathAssistant {...base} pathId="same-discipline-baoyan" />)
    expect(screen.getByText(/个性化解读/)).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/追问/)).toBeInTheDocument()
  })

  it('解读文本就绪时展示出来', () => {
    stub({ completion: '你现在大一，保研是时间窗最紧的一条路。' })
    render(<PathAssistant {...base} pathId="same-discipline-baoyan" />)
    expect(screen.getByText(/保研是时间窗最紧的一条路/)).toBeInTheDocument()
  })

  it('把记录 id 与路径 id 一起发给后端（服务端据此从自己的库取答案）', () => {
    render(<PathAssistant {...base} pathId="civil-service" />)
    const options = vi.mocked(useCompletion).mock.calls[0]![0] as { body: Record<string, unknown> }
    expect(options.body).toMatchObject({ assessmentId: 'a1', pathId: 'civil-service' })
  })

  it('传入已有解读时直接渲染，不再自动生成', () => {
    const complete = vi.fn()
    vi.mocked(useCompletion).mockReturnValue({
      completion: '', complete, isLoading: false, error: undefined,
    } as never)

    render(<PathAssistant assessmentId="a1" pathId="p1" interpretation="存下来的解读" />)

    expect(screen.getByText('存下来的解读')).toBeInTheDocument()
    // 已有解读就不该再调一次模型：既省钱，也是「历史详情不重算」的保证（spec §5.2）
    expect(complete).not.toHaveBeenCalled()
  })

  it('解读不可用时显示降级提示，而不是空白', () => {
    stub({ interpretError: new Error('503') })
    render(<PathAssistant {...base} pathId="same-discipline-baoyan" />)
    expect(screen.getByText(/个性化解读暂不可用/)).toBeInTheDocument()
  })

  it('展示已有的追问对话', () => {
    stub({
      messages: [
        { id: 'm1', role: 'user', parts: [{ type: 'text', text: '保研和考研怎么选？' }] },
        { id: 'm2', role: 'assistant', parts: [{ type: 'text', text: '两者时间窗不同。' }] },
      ],
    })
    render(<PathAssistant {...base} pathId="same-discipline-baoyan" />)
    expect(screen.getByText(/保研和考研怎么选？/)).toBeInTheDocument()
    expect(screen.getByText(/两者时间窗不同。/)).toBeInTheDocument()
  })
})

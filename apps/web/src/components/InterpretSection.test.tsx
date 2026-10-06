import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('@ai-sdk/react', () => ({
  useCompletion: vi.fn(),
  useChat: vi.fn(),
}))

import { useChat, useCompletion } from '@ai-sdk/react'
import { fetchChatHistory } from '../api.js'
import { InterpretSection } from './InterpretSection.js'

vi.mock('../api.js', async () => {
  const actual = await vi.importActual<typeof import('../api.js')>('../api.js')
  return { ...actual, fetchChatHistory: vi.fn() }
})

const setMessages = vi.fn()
const sendMessage = vi.fn()

function stub(overrides: {
  completion?: string
  interpreting?: boolean
  interpretError?: Error
  messages?: unknown[]
} = {}) {
  vi.mocked(useCompletion).mockReturnValue({
    completion: overrides.completion ?? '',
    complete: vi.fn(),
    isLoading: overrides.interpreting ?? false,
    error: overrides.interpretError,
  } as never)
  vi.mocked(useChat).mockReturnValue({
    messages: overrides.messages ?? [],
    setMessages,
    sendMessage,
    status: 'ready',
    error: undefined,
  } as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(fetchChatHistory).mockResolvedValue([])
  stub()
})

describe('InterpretSection · 解读', () => {
  it('把记录 id 与路径 id 一起发给后端，并按纯文本流消费', () => {
    render(<InterpretSection assessmentId="a1" pathId="civil-service" />)
    const options = vi.mocked(useCompletion).mock.calls[0]![0] as Record<string, unknown>
    expect(options.body).toMatchObject({ assessmentId: 'a1', pathId: 'civil-service' })
    expect(options.streamProtocol).toBe('text')
  })

  it('传入已有解读时直接渲染、不重新生成（历史详情不重算）', () => {
    const complete = vi.fn()
    vi.mocked(useCompletion).mockReturnValue({
      completion: '', complete, isLoading: false, error: undefined,
    } as never)
    render(<InterpretSection assessmentId="a1" pathId="p1" interpretation="存下来的解读" />)
    expect(screen.getByText('存下来的解读')).toBeInTheDocument()
    expect(complete).not.toHaveBeenCalled()
  })

  it('存下来的解读同样剥离【可以问我】行并给出芯片', () => {
    render(
      <InterpretSection
        assessmentId="a1" pathId="p1"
        interpretation={'解读正文。\n【可以问我】保研率大概多少？'}
      />,
    )
    expect(screen.getByText('解读正文。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '保研率大概多少？' })).toBeInTheDocument()
    expect(screen.queryByText(/【可以问我】/)).not.toBeInTheDocument()
  })

  it('503/无输出时整区隐藏（spec §7.3），而不是显示降级提示', () => {
    stub({ interpretError: new Error('503') })
    const { container } = render(<InterpretSection assessmentId="a1" pathId="p1" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('流中断但已有输出：保留内容并给出「继续生成解读」', () => {
    stub({ completion: '已经写出来的部分', interpretError: new Error('stream broken') })
    render(<InterpretSection assessmentId="a1" pathId="p1" />)
    expect(screen.getByText('已经写出来的部分')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '继续生成解读' })).toBeInTheDocument()
  })

  it('流式中显示光标，建议芯片不提前出现', () => {
    stub({ completion: '正文【可以问我】半截', interpreting: true })
    render(<InterpretSection assessmentId="a1" pathId="p1" />)
    expect(screen.getByText('正文')).toBeInTheDocument()
    expect(screen.queryByText(/半截/)).not.toBeInTheDocument()
  })
})

describe('InterpretSection · 追问', () => {
  it('展示已有对话并可发送', async () => {
    stub({
      messages: [
        { id: 'm1', role: 'user', parts: [{ type: 'text', text: '保研和考研怎么选？' }] },
        { id: 'm2', role: 'assistant', parts: [{ type: 'text', text: '两者时间窗不同。' }] },
      ],
    })
    render(<InterpretSection assessmentId="a1" pathId="p1" />)
    expect(screen.getByText(/保研和考研怎么选？/)).toBeInTheDocument()

    await userEvent.type(screen.getByPlaceholderText(/追问/), '那时间窗是？')
    await userEvent.click(screen.getByRole('button', { name: '发送' }))
    expect(sendMessage).toHaveBeenCalledWith({ text: '那时间窗是？' })
  })

  it('点建议芯片等于把问题发出去', async () => {
    stub({ completion: '正文。\n【可以问我】保研率大概多少？' })
    render(<InterpretSection assessmentId="a1" pathId="p1" />)
    await userEvent.click(await screen.findByRole('button', { name: '保研率大概多少？' }))
    expect(sendMessage).toHaveBeenCalledWith({ text: '保研率大概多少？' })
  })

  it('挂载时拉账号级历史，用更新函数合并，不冲掉在途轮次', async () => {
    vi.mocked(fetchChatHistory).mockResolvedValue([
      { id: 'old', role: 'user', parts: [{ type: 'text', text: '更早的问题' }] },
    ])
    render(<InterpretSection assessmentId="a1" pathId="p1" />)
    await waitFor(() => expect(setMessages).toHaveBeenCalled())

    const updater = setMessages.mock.calls.at(-1)![0] as (prev: unknown[]) => unknown[]
    expect(typeof updater).toBe('function')
    const inFlight = [{ id: 'mine', role: 'user', parts: [{ type: 'text', text: '我刚问的' }] }]
    expect(updater(inFlight)).toEqual([
      { id: 'old', role: 'user', parts: [{ type: 'text', text: '更早的问题' }] },
      { id: 'mine', role: 'user', parts: [{ type: 'text', text: '我刚问的' }] },
    ])
  })
})

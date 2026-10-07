import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
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

/**
 * jsdom 不做排版，scrollHeight / clientHeight 恒为 0——折叠与否取决于这两个值，
 * 所以按用例把量出来的高度顶掉。删除自有的原型属性即恢复继承来的实现
 */
function setOverflow(overflowing: boolean) {
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get: () => (overflowing ? 400 : 100),
  })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get: () => 171,
  })
}

afterEach(() => {
  delete (HTMLElement.prototype as { scrollHeight?: unknown }).scrollHeight
  delete (HTMLElement.prototype as { clientHeight?: unknown }).clientHeight
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

  it('超过 6 行时折叠，并用「展开个性化解读」展开（spec §5.5 04 段）', async () => {
    setOverflow(true)
    render(<InterpretSection assessmentId="a1" pathId="p1" interpretation="一段很长的解读" />)
    const body = screen.getByText('一段很长的解读')
    expect(body.className).toContain('max-h-[171px]')

    await userEvent.click(screen.getByRole('button', { name: '展开个性化解读' }))
    expect(body.className).not.toContain('max-h-[171px]')
    expect(screen.queryByRole('button', { name: '展开个性化解读' })).not.toBeInTheDocument()
  })

  it('不超过 6 行时不折叠，也不出现展开按钮', () => {
    setOverflow(false)
    render(<InterpretSection assessmentId="a1" pathId="p1" interpretation="短解读" />)
    expect(screen.getByText('短解读').className).not.toContain('max-h-[171px]')
    expect(screen.queryByRole('button', { name: '展开个性化解读' })).not.toBeInTheDocument()
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

  it('做成固定尺寸可滚动的对话框，消息左右分栏：你在右、Navi 在左（spec §5.5 04 段）', () => {
    stub({
      messages: [
        { id: 'm1', role: 'user', parts: [{ type: 'text', text: '保研和考研怎么选？' }] },
        { id: 'm2', role: 'assistant', parts: [{ type: 'text', text: '两者时间窗不同。' }] },
      ],
    })
    const { container } = render(<InterpretSection assessmentId="a1" pathId="p1" />)
    const box = container.querySelector('.h-\\[360px\\]')
    expect(box?.className).toContain('overflow-y-auto')
    expect(screen.getByText(/保研和考研怎么选？/).closest('li')?.className).toContain('justify-end')
    expect(screen.getByText(/两者时间窗不同。/).closest('li')?.className).toContain('justify-start')
  })

  it('推荐提问贴着输入框：排在对话框与输入框之间（spec §5.5 04 段）', () => {
    render(
      <InterpretSection
        assessmentId="a1" pathId="p1"
        interpretation={'正文。\n【可以问我】保研率大概多少？'}
      />,
    )
    const chip = screen.getByRole('button', { name: '保研率大概多少？' })
    const box = screen.getByPlaceholderText(/追问/).closest('section')!.querySelector('.h-\\[360px\\]')!
    const input = screen.getByPlaceholderText(/追问/)
    // 对话框 → 推荐提问 → 输入框：提问入口贴着输入框，不再挂在解读正文下面
    expect(box.compareDocumentPosition(chip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(chip.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('追问区提示核对，不再宣讲账号级连续对话（用户决策）', () => {
    render(<InterpretSection assessmentId="a1" pathId="p1" interpretation="正文" />)
    expect(screen.getByText('Navi也可能会出错，重要信息请仔细核对。')).toBeInTheDocument()
  })
})

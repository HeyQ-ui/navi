import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useRef } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fetchMe, fetchPathKnowledge, fetchQuestions, postDiagnose } from '../api.js'
import type { PathKnowledge } from '../api.js'
import { FlowProvider, useFlow } from '../state.js'
import { PathDetailPage } from './PathDetailPage.js'

vi.mock('../api.js', async () => {
  const actual = await vi.importActual<typeof import('../api.js')>('../api.js')
  return {
    ...actual,
    fetchMe: vi.fn(), fetchPathKnowledge: vi.fn(), fetchQuestions: vi.fn(), postDiagnose: vi.fn(),
    authenticate: vi.fn(), logout: vi.fn(), fetchMeta: vi.fn(),
  }
})

// BlockRenderer 已有自己的测试——这里只验证块被如数交下
vi.mock('../components/BlockRenderer.js', () => ({
  BlockRenderer: ({ blocks }: { blocks: unknown[] }) => (
    <div data-testid="blocks">{blocks.length} 个块</div>
  ),
}))

// 标注 PathKnowledge：否则 path.status 会被推断成 string，赋给联合字面量类型时过不了 tsc
const knowledge: PathKnowledge = {
  path: {
    id: 'same-discipline-baoyan', title: '本学科保研', category: 'academic',
    span: 'same-discipline', status: 'draft', summary: '摘要一句话',
    weights: [], eligibility: [],
  },
  blocks: [{ type: 'timeline', title: '', html: '', raw: '' }],
}

function renderPage() {
  return render(<FlowProvider><PathDetailPage pathId="same-discipline-baoyan" /></FlowProvider>)
}

/**
 * 从结果页进详情的场景：探针把流程走一遍，让 state 里有结果。
 * 用 ref 持有「最新一次渲染」的 flow：chooseGrade 会改 grade，之后的提交必须走绑定
 * 到刷新后 grade 的 submit；直接闭包捕获点击时的 flow 会拿到 grade 仍为 null 的旧
 * submit（它第一行就 `return 'error'`），结果永远进不了 state。
 */
function RunProbe() {
  const flow = useFlow()
  const latest = useRef(flow)
  latest.current = flow
  async function run() {
    await latest.current.chooseGrade('freshman')
    await latest.current.submit()
  }
  return <button type="button" onClick={() => void run()}>走一遍流程</button>
}

beforeEach(() => {
  window.history.pushState({}, '', '/path/same-discipline-baoyan')
  vi.mocked(fetchMe).mockResolvedValue(null)
  vi.mocked(fetchPathKnowledge).mockResolvedValue(knowledge)
})

describe('PathDetailPage', () => {
  it('标题、摘要与知识块；浏览器标题为「{路径名}-详情」（spec §4.1）', async () => {
    renderPage()
    expect(await screen.findByRole('heading', { name: '本学科保研' })).toBeInTheDocument()
    expect(screen.getByText('摘要一句话')).toBeInTheDocument()
    expect(screen.getByTestId('blocks')).toHaveTextContent('1 个块')
    await waitFor(() => expect(document.title).toBe('本学科保研-详情'))
  })

  it('draft 路径带待核实角标（spec §3.6）', async () => {
    renderPage()
    expect(await screen.findByText('待核实')).toBeInTheDocument()
  })

  it('直达（无结果上下文）时没有匹配分，返回链接指向首页', async () => {
    renderPage()
    await screen.findByRole('heading', { name: '本学科保研' })
    expect(screen.queryByText('匹配分')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /回到首页/ })).toHaveAttribute('href', '/')
  })

  it('从结果页进来时带上匹配分，返回链接指向结果页', async () => {
    vi.mocked(fetchQuestions).mockResolvedValue({
      questions: [{ id: 'q1', text: 't', options: ['a'], weight: 1 }],
      indicators: [], paths: [],
    })
    vi.mocked(postDiagnose).mockResolvedValue({
      indicators: {}, archetypes: [], tiedPaths: [], assessmentId: 'a1',
      paths: [{
        id: 'same-discipline-baoyan', match: 78, confidence: 0.9,
        eligibility: { applicable: true, hardFailures: [], softWarnings: [] },
        contributions: [],
      }],
    })
    render(<FlowProvider><PathDetailPage pathId="same-discipline-baoyan" /><RunProbe /></FlowProvider>)
    await userEvent.click(await screen.findByRole('button', { name: '走一遍流程' }))
    expect(await screen.findByText('78')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /回到结果/ })).toHaveAttribute('href', '/result')
  })

  it('加载中显示暖纸色骨架屏（spec §7.1）', () => {
    vi.mocked(fetchPathKnowledge).mockReturnValue(new Promise<PathKnowledge>(() => {}))
    const { container } = renderPage()
    expect(container.querySelector('.skeleton')).not.toBeNull()
  })

  it('加载失败时内联错误并可重试（不弹框，spec §7.2）', async () => {
    vi.mocked(fetchPathKnowledge).mockRejectedValueOnce(new Error('路径不存在：nope'))
    renderPage()
    expect(await screen.findByText('路径不存在：nope')).toBeInTheDocument()
    vi.mocked(fetchPathKnowledge).mockResolvedValueOnce(knowledge)
    await userEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(await screen.findByRole('heading', { name: '本学科保研' })).toBeInTheDocument()
  })
})

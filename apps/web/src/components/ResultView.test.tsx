import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// ResultView 内部会挂载 PathAssistant，后者用 useCompletion / useChat 发请求。
// jsdom 里没有后端，必须替身掉，否则每个 ResultView 用例都会产生未处理的 fetch 失败。
vi.mock('@ai-sdk/react', () => ({
  useCompletion: vi.fn(),
  useChat: vi.fn(),
}))

import { useChat, useCompletion } from '@ai-sdk/react'
import { ResultView } from './ResultView.js'
import type { DiagnosisResult, PathSummary } from '../api.js'

beforeEach(() => {
  // 解读内容随 pathId 变——这样「换路径不串台」可以直接断言文本，而不是靠节点身份间接推断
  vi.mocked(useCompletion).mockImplementation(((options: { body: { pathId: string } }) => ({
    completion: `解读-${options.body.pathId}`,
    complete: vi.fn(),
    isLoading: false,
    error: undefined,
  })) as never)
  vi.mocked(useChat).mockReturnValue({
    messages: [], sendMessage: vi.fn(), status: 'ready', error: undefined,
  } as never)
})

const paths: PathSummary[] = [
  { id: 'same-discipline-baoyan', title: '本学科保研', category: 'academic', span: 'same-discipline', status: 'verified', summary: '' },
  { id: 'civil-service', title: '考公考编 / 选调生', category: 'civil', span: 'same-discipline', status: 'draft', summary: '' },
]

const result: DiagnosisResult = {
  indicators: {
    'academic-interest': { score: 75, known: true, consistency: 1, sources: ['q1','q2','q3'] },
  },
  paths: [
    {
      id: 'same-discipline-baoyan', match: 78, confidence: 0.9,
      eligibility: { applicable: true, hardFailures: [], softWarnings: [] },
      contributions: [{ indicator: 'academic-interest', match: 90, weight: 1, contribution: 90 }],
    },
    {
      id: 'civil-service', match: 0, confidence: 0.5,
      eligibility: {
        applicable: false,
        hardFailures: [{ id: 'x', severity: 'hard', message: '你的专业没有对口岗位' }],
        softWarnings: [],
      },
      contributions: [],
    },
  ],
  archetypes: [{ id: 'steady-scholar', affinity: 0.68 }],
}

describe('ResultView', () => {
  it('显示路径名称与匹配分', () => {
    render(<ResultView result={result} paths={paths} answers={{}} grade="freshman" />)
    expect(screen.getByText('本学科保研')).toBeInTheDocument()
    expect(screen.getByText(/78/)).toBeInTheDocument()
  })

  it('显示置信度百分比', () => {
    render(<ResultView result={result} paths={paths} answers={{}} grade="freshman" />)
    expect(screen.getByText(/90%/)).toBeInTheDocument()
  })

  it('不适用路径仍然显示，并给出失败原因', () => {
    render(<ResultView result={result} paths={paths} answers={{}} grade="freshman" />)
    expect(screen.getByText('考公考编 / 选调生')).toBeInTheDocument()
    expect(screen.getByText(/你的专业没有对口岗位/)).toBeInTheDocument()
  })

  it('待核实内容的路径显示角标', () => {
    render(<ResultView result={result} paths={paths} answers={{}} grade="freshman" />)
    expect(screen.getByText(/待核实/)).toBeInTheDocument()
  })

  it('显示画像归属百分比', () => {
    render(<ResultView result={result} paths={paths} answers={{}} grade="freshman" />)
    expect(screen.getByText(/68%/)).toBeInTheDocument()
  })

  it('空路径列表时不崩溃', () => {
    const empty: DiagnosisResult = { indicators: {}, paths: [], archetypes: [] }
    expect(() => render(<ResultView result={empty} paths={[]} answers={{}} grade="freshman" />)).not.toThrow()
  })
})

describe('ResultView · 接近路径提示（设计文档 §10）', () => {
  it('多条路径分数接近时给出提示', () => {
    render(
      <ResultView
        result={result}
        paths={paths}
        closeMatches={['same-discipline-baoyan', 'civil-service']}
        answers={{}}
        grade="freshman"
      />,
    )
    expect(screen.getByText(/很接近/)).toBeInTheDocument()
  })

  it('只有一条路径时不给接近提示', () => {
    render(
      <ResultView
        result={result}
        paths={paths}
        closeMatches={['same-discipline-baoyan']}
        answers={{}}
        grade="freshman"
      />,
    )
    expect(screen.queryByText(/很接近/)).not.toBeInTheDocument()
  })
})

describe('ResultView · 全部路径不适用（设计文档 §10）', () => {
  const noneApplicable: DiagnosisResult = {
    ...result,
    paths: result.paths.map(path => ({
      ...path,
      match: 0,
      eligibility: { ...path.eligibility, applicable: false },
    })),
  }

  it('给出「当前没有匹配的路径」汇总提示，同时保留逐条原因', () => {
    render(<ResultView result={noneApplicable} paths={paths} answers={{}} grade="freshman" />)
    expect(screen.getByText(/当前没有匹配的路径/)).toBeInTheDocument()
    expect(screen.getByText(/你的专业没有对口岗位/)).toBeInTheDocument()
  })

  it('此时不再给出「分数很接近」提示', () => {
    render(
      <ResultView
        result={noneApplicable}
        paths={paths}
        closeMatches={['same-discipline-baoyan', 'civil-service']}
        answers={{}}
        grade="freshman"
      />,
    )
    expect(screen.queryByText(/很接近/)).not.toBeInTheDocument()
  })
})

describe('ResultView · 本路径选择（设计文档 §8.5）', () => {
  it('默认选中匹配度最高的那条路径', () => {
    render(<ResultView result={result} paths={paths} answers={{}} grade="freshman" />)
    expect(screen.getByRole('radio', { name: /本学科保研/ })).toBeChecked()
  })

  it('点选另一条路径后选中项改变', async () => {
    render(<ResultView result={result} paths={paths} answers={{}} grade="freshman" />)
    await userEvent.click(screen.getByRole('radio', { name: /考公考编/ }))
    expect(screen.getByRole('radio', { name: /考公考编/ })).toBeChecked()
    expect(screen.getByRole('radio', { name: /本学科保研/ })).not.toBeChecked()
  })

  it('切换路径时上一路径的解读消失、新路径的解读出现（不串台）', async () => {
    render(<ResultView result={result} paths={paths} answers={{}} grade="freshman" />)
    expect(screen.getByText('解读-same-discipline-baoyan')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('radio', { name: /考公考编/ }))

    expect(screen.queryByText('解读-same-discipline-baoyan')).not.toBeInTheDocument()
    expect(screen.getByText('解读-civil-service')).toBeInTheDocument()
  })

  it('切换路径时 PathAssistant 重新挂载（否则真实 hook 的对话状态不会重置）', async () => {
    // 上面那条断言的是「数据接对了」，这条断言的是「组件被重建了」——真实 useChat /
    // useCompletion 的对话状态挂在组件实例上，只有卸载重建才会清空。缺 key 时上面那条
    // 仍然会通过（mock 每次渲染都按新 pathId 给值），所以两条必须都在。
    render(<ResultView result={result} paths={paths} answers={{}} grade="freshman" />)
    const before = screen.getByPlaceholderText(/追问/)

    await userEvent.click(screen.getByRole('radio', { name: /考公考编/ }))

    expect(screen.getByPlaceholderText(/追问/)).not.toBe(before)
  })
})

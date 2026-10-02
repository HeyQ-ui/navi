import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

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
  // 解读内容随 pathId 变，这样「解读锚在哪条路径」可以直接断言文本
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
  it('显示主推荐路径的名称与匹配分', () => {
    render(<ResultView result={result} paths={paths} assessmentId="a1" />)
    expect(screen.getByText('本学科保研')).toBeInTheDocument()
    expect(screen.getByText(/匹配度 78/)).toBeInTheDocument()
  })

  it('不再显示置信度', () => {
    render(<ResultView result={result} paths={paths} assessmentId="a1" />)
    expect(screen.queryByText(/置信度/)).not.toBeInTheDocument()
    expect(screen.queryByText(/90%/)).not.toBeInTheDocument()
  })

  it('主推荐只取可适用路径：硬性不适用的高分路径落进折叠区', () => {
    const topInapplicable: DiagnosisResult = {
      ...result,
      paths: [
        {
          id: 'civil-service', match: 95, confidence: 0.5,
          eligibility: { applicable: false, hardFailures: [{ id: 'x', severity: 'hard', message: '你的专业没有对口岗位' }], softWarnings: [] },
          contributions: [],
        },
        result.paths[0]!,
      ],
    }
    render(<ResultView result={topInapplicable} paths={paths} assessmentId="a1" />)

    // 判据只看「折叠区里有没有不适用项」：95 分那条若占了主位，折叠区就只剩一条可适用路径，
    // 「含 N 条对你暂不适用」不会出现。只断言标题出现是区分不出来的——两种摆放它都恰好出现一次。
    expect(screen.getByText(/含 1 条对你暂不适用/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '本学科保研' })).toBeInTheDocument()
  })

  it('其余路径收进只读折叠区，逐条给出不适用原因', () => {
    render(<ResultView result={result} paths={paths} assessmentId="a1" />)
    expect(screen.getByText(/查看其他 1 条路径/)).toBeInTheDocument()
    expect(screen.getByText(/你的专业没有对口岗位/)).toBeInTheDocument()
    // 折叠区里没有选择控件
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
  })

  it('待核实内容的路径显示角标', () => {
    render(<ResultView result={result} paths={paths} assessmentId="a1" />)
    expect(screen.getByText(/待核实/)).toBeInTheDocument()
  })

  it('显示画像归属百分比', () => {
    render(<ResultView result={result} paths={paths} assessmentId="a1" />)
    expect(screen.getByText(/68%/)).toBeInTheDocument()
  })

  it('空路径列表时不崩溃', () => {
    const empty: DiagnosisResult = { indicators: {}, paths: [], archetypes: [] }
    expect(() => render(<ResultView result={empty} paths={[]} assessmentId="a1" />)).not.toThrow()
  })

  it('无可折叠内容时不渲染折叠区（Review Focus 1）', () => {
    const single: DiagnosisResult = { ...result, paths: [result.paths[0]!] }
    render(<ResultView result={single} paths={paths} assessmentId="a1" />)
    expect(screen.queryByText(/查看其他/)).not.toBeInTheDocument()
  })
})

describe('ResultView · 并列提示（设计文档 §9.3）', () => {
  it('显示分相同时一并列出，并说明差异不在谁更合适', () => {
    render(
      <ResultView
        result={result}
        paths={paths}
        tiedPaths={['same-discipline-baoyan', 'civil-service']}
        assessmentId="a1"
      />,
    )
    expect(screen.getByText(/对你的分数相同/)).toBeInTheDocument()
  })

  it('只有主推荐一条时不提示并列', () => {
    render(
      <ResultView
        result={result}
        paths={paths}
        tiedPaths={['same-discipline-baoyan']}
        assessmentId="a1"
      />,
    )
    expect(screen.queryByText(/对你的分数相同/)).not.toBeInTheDocument()
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
    render(<ResultView result={noneApplicable} paths={paths} assessmentId="a1" />)
    expect(screen.getByText(/当前没有匹配的路径/)).toBeInTheDocument()
    expect(screen.getByText(/你的专业没有对口岗位/)).toBeInTheDocument()
  })

  it('此时不给并列提示，且原因仍逐条留在折叠区（Review Focus 1）', () => {
    render(
      <ResultView
        result={noneApplicable}
        paths={paths}
        tiedPaths={['same-discipline-baoyan', 'civil-service']}
        assessmentId="a1"
      />,
    )
    // 主推荐卡与汇总提示是同一个三元分支的两支：汇总提示出现即等价于主推荐卡没出现。
    // （不能拿「页面上有没有匹配度」当判据——折叠区逐条渲染匹配度，必然命中。）
    expect(screen.getByText(/当前没有匹配的路径/)).toBeInTheDocument()
    expect(screen.queryByText(/对你的分数相同/)).not.toBeInTheDocument()
    expect(screen.getByText(/含 2 条对你暂不适用/)).toBeInTheDocument()
  })

  it('全部不适用时不挂载追问区（没有可锚定的路径）', () => {
    render(<ResultView result={noneApplicable} paths={paths} assessmentId="a1" />)
    expect(screen.queryByPlaceholderText(/追问/)).not.toBeInTheDocument()
  })
})

describe('ResultView · 解读锚定主推荐路径（设计文档 §8.5）', () => {
  it('解读区锚在可适用的最高分路径上', () => {
    render(<ResultView result={result} paths={paths} assessmentId="a1" />)
    expect(screen.getByText('解读-same-discipline-baoyan')).toBeInTheDocument()
  })
})

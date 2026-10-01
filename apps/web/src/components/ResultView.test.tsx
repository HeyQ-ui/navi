import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ResultView } from './ResultView.js'
import type { DiagnosisResult, PathSummary } from '../api.js'

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
    render(<ResultView result={result} paths={paths} />)
    expect(screen.getByText('本学科保研')).toBeInTheDocument()
    expect(screen.getByText(/78/)).toBeInTheDocument()
  })

  it('显示置信度百分比', () => {
    render(<ResultView result={result} paths={paths} />)
    expect(screen.getByText(/90%/)).toBeInTheDocument()
  })

  it('不适用路径仍然显示，并给出失败原因', () => {
    render(<ResultView result={result} paths={paths} />)
    expect(screen.getByText('考公考编 / 选调生')).toBeInTheDocument()
    expect(screen.getByText(/你的专业没有对口岗位/)).toBeInTheDocument()
  })

  it('待核实内容的路径显示角标', () => {
    render(<ResultView result={result} paths={paths} />)
    expect(screen.getByText(/待核实/)).toBeInTheDocument()
  })

  it('显示画像归属百分比', () => {
    render(<ResultView result={result} paths={paths} />)
    expect(screen.getByText(/68%/)).toBeInTheDocument()
  })

  it('空路径列表时不崩溃', () => {
    const empty: DiagnosisResult = { indicators: {}, paths: [], archetypes: [] }
    expect(() => render(<ResultView result={empty} paths={[]} />)).not.toThrow()
  })
})

describe('ResultView · 接近路径提示（设计文档 §10）', () => {
  it('多条路径分数接近时给出提示', () => {
    render(
      <ResultView
        result={result}
        paths={paths}
        closeMatches={['same-discipline-baoyan', 'civil-service']}
      />,
    )
    expect(screen.getByText(/很接近/)).toBeInTheDocument()
  })

  it('只有一条路径时不给接近提示', () => {
    render(<ResultView result={result} paths={paths} closeMatches={['same-discipline-baoyan']} />)
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
    render(<ResultView result={noneApplicable} paths={paths} />)
    expect(screen.getByText(/当前没有匹配的路径/)).toBeInTheDocument()
    expect(screen.getByText(/你的专业没有对口岗位/)).toBeInTheDocument()
  })

  it('此时不再给出「分数很接近」提示', () => {
    render(
      <ResultView
        result={noneApplicable}
        paths={paths}
        closeMatches={['same-discipline-baoyan', 'civil-service']}
      />,
    )
    expect(screen.queryByText(/很接近/)).not.toBeInTheDocument()
  })
})

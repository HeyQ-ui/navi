import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@ai-sdk/react', () => ({ useCompletion: vi.fn(), useChat: vi.fn() }))
vi.mock('./ProfileRadar.js', () => ({ ProfileRadar: () => <div data-testid="radar" /> }))

/** 捕获 ResultBody 交给解读区的 props，用来端到端断言「解读锚在主推荐路径」。 */
const interpretProps = vi.hoisted(() => ({
  current: null as null | { assessmentId: string; pathId: string; interpretation?: string | null },
}))
// 只捕获 props、不触发流式请求；渲染出既有用例可识别的结构（placeholder 含「追问」，
// 供「解读区是否挂载」的既有断言使用），以免破坏既有用例。
vi.mock('./InterpretSection.js', () => ({
  InterpretSection: (props: { assessmentId: string; pathId: string; interpretation?: string | null }) => {
    interpretProps.current = props
    return <input placeholder="就这条路径追问……" />
  },
}))

import { useChat, useCompletion } from '@ai-sdk/react'
import { fetchChatHistory, fetchMeta, fetchPathKnowledge } from '../api.js'
import { ResultBody } from './ResultBody.js'
import type { DiagnosisResult, PathSummary } from '../api.js'

vi.mock('../api.js', async () => {
  const actual = await vi.importActual<typeof import('../api.js')>('../api.js')
  return {
    ...actual,
    fetchChatHistory: vi.fn(),
    fetchMeta: vi.fn(),
    fetchPathKnowledge: vi.fn(),
  }
})

beforeEach(() => {
  interpretProps.current = null
  vi.mocked(useCompletion).mockImplementation(((options: { body: { pathId: string } }) => ({
    completion: `解读-${options.body.pathId}`,
    complete: vi.fn(), isLoading: false, error: undefined,
  })) as never)
  vi.mocked(useChat).mockReturnValue({
    messages: [], setMessages: vi.fn(), sendMessage: vi.fn(), status: 'ready', error: undefined,
  } as never)
  vi.mocked(fetchChatHistory).mockResolvedValue([])
  vi.mocked(fetchMeta).mockResolvedValue({
    archetypes: [{
      id: 'steady-scholar', name: '稳健学术型',
      narrative: { oneLiner: '一句话人设', strengths: ['坐得住'], blindspots: ['起步晚'] },
    }],
    indicators: [{ id: 'academic-interest', name: '学术志趣' }],
  })
  vi.mocked(fetchPathKnowledge).mockResolvedValue({
    path: {
      id: 'same-discipline-baoyan', title: '本学科保研', category: 'academic',
      span: 'same-discipline', status: 'verified', summary: '',
      weights: [{ indicator: 'academic-interest', weight: 1, ideal: 90 }],
      eligibility: [],
    },
    blocks: [],
  })
})

const paths: PathSummary[] = [
  { id: 'same-discipline-baoyan', title: '本学科保研', category: 'academic', span: 'same-discipline', status: 'verified', summary: '摘要一句话' },
  { id: 'civil-service', title: '考公考编 / 选调生', category: 'civil', span: 'same-discipline', status: 'draft', summary: '' },
]

const result: DiagnosisResult = {
  indicators: { 'academic-interest': { score: 75, known: true, consistency: 1, sources: [] } },
  paths: [
    {
      id: 'same-discipline-baoyan', match: 78, confidence: 0.9,
      eligibility: { applicable: true, hardFailures: [], softWarnings: [] },
      contributions: [],
    },
    {
      id: 'civil-service', match: 40, confidence: 0.5,
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

function renderBody(props: Partial<Parameters<typeof ResultBody>[0]> = {}) {
  return render(
    <ResultBody
      result={result} paths={paths} tiedPaths={[]} assessmentId="a1"
      interpretation={null} {...props}
    />,
  )
}

describe('ResultBody · 主推荐（契约延续）', () => {
  it('显示主推荐路径的名称与匹配分', async () => {
    renderBody()
    expect(await screen.findByText('本学科保研')).toBeInTheDocument()
    expect(screen.getByText(/78/)).toBeInTheDocument()
  })

  it('不再显示置信度', () => {
    renderBody()
    expect(screen.queryByText(/置信度/)).not.toBeInTheDocument()
  })

  it('主推荐只取可适用路径：高分但硬性不适用不进主位', () => {
    const topInapplicable: DiagnosisResult = {
      ...result,
      paths: [{ ...result.paths[1]!, match: 95 }, result.paths[0]!],
    }
    renderBody({ result: topInapplicable })
    expect(screen.getByRole('heading', { name: '本学科保研' })).toBeInTheDocument()
  })

  it('待核实角标只出现在非 verified 路径上', async () => {
    renderBody()
    expect((await screen.findAllByText('待核实')).length).toBe(1)
  })

  it('并列路径一并列出，说明差异不在谁更合适', () => {
    renderBody({ tiedPaths: ['same-discipline-baoyan', 'civil-service'] })
    expect(screen.getByText(/对你的分数相同/)).toBeInTheDocument()
  })

  it('其他路径是可点击的行，通往各自详情（spec 差异 #2）', () => {
    renderBody()
    const link = screen.getByRole('link', { name: /考公考编/ })
    expect(link).toHaveAttribute('href', '/path/civil-service')
  })

  it('不适用路径置灰并给出原因', () => {
    renderBody()
    expect(screen.getByText(/你的专业没有对口岗位/)).toBeInTheDocument()
  })

  it('空路径列表时不崩溃', () => {
    expect(() => renderBody({
      result: { indicators: {}, paths: [], archetypes: [] }, paths: [],
    })).not.toThrow()
  })
})

describe('ResultBody · 画像段', () => {
  it('主原型名、亲和度与人设来自 /api/meta', async () => {
    renderBody()
    expect(await screen.findByText('稳健学术型')).toBeInTheDocument()
    expect(screen.getByText(/68%/)).toBeInTheDocument()
    expect(screen.getByText('一句话人设')).toBeInTheDocument()
    expect(screen.getByText('坐得住')).toBeInTheDocument()
    expect(screen.getByText('起步晚')).toBeInTheDocument()
  })
})

describe('ResultBody · 差距榜', () => {
  it('用主推荐路径的理想画像算差距', async () => {
    renderBody()
    expect(await screen.findByText(/你 75 · 理想 90/)).toBeInTheDocument()
  })

  it('指标分是加权平均，显示保留 1 位小数（spec §5.5 03 段）', async () => {
    renderBody({
      result: {
        ...result,
        indicators: {
          'academic-interest': { score: 16.666666666666668, known: true, consistency: 1, sources: [] },
        },
      },
    })
    expect(await screen.findByText(/你 16\.7 · 理想 90/)).toBeInTheDocument()
  })
})

describe('ResultBody · 全部路径不适用（spec §7.4）', () => {
  const noneApplicable: DiagnosisResult = {
    ...result,
    paths: result.paths.map(p => ({ ...p, match: 0, eligibility: { ...p.eligibility, applicable: false } })),
  }

  it('给出显式态与两个出口，解读区不挂载', () => {
    renderBody({ result: noneApplicable })
    expect(screen.getByText('这一次，没有足够适配的路径')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '重新测评' })).toHaveAttribute('href', '/')
    expect(screen.queryByPlaceholderText(/追问/)).not.toBeInTheDocument()
  })
})

// 契约来源：旧 PathAssistant.test.tsx「解读 same-discipline-baoyan」。
// 承接「解读锚在主推荐路径」——ResultBody 选取主推荐、InterpretSection 按 pathId 发起解读，
// 此处端到端钉住交接给解读区的 pathId 就是被选中的主推荐路径 id，而非其它路径。
describe('ResultBody · 解读锚定主推荐路径（契约延续）', () => {
  it('解读区收到的 pathId 是被选中的主推荐路径 id（可适用路径不在首位时也锚它）', () => {
    // 高分但硬性不适用的 civil-service 排在首位，可适用的 same-discipline-baoyan 在次位。
    const applicableNotFirst: DiagnosisResult = {
      ...result,
      paths: [{ ...result.paths[1]!, match: 95 }, result.paths[0]!],
    }
    renderBody({ result: applicableNotFirst })

    expect(interpretProps.current?.pathId).toBe('same-discipline-baoyan')
    expect(interpretProps.current?.pathId).not.toBe('civil-service')
    expect(interpretProps.current?.assessmentId).toBe('a1')
  })
})

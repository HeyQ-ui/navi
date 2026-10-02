import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fetchAssessment, fetchAssessments, fetchMe, fetchQuestions, postDiagnose } from './api.js'
import { App } from './App.js'

vi.mock('./api.js', () => ({
  fetchMe: vi.fn(),
  fetchQuestions: vi.fn(),
  postDiagnose: vi.fn(),
  authenticate: vi.fn(),
  logout: vi.fn(),
  fetchAssessments: vi.fn(),
  fetchAssessment: vi.fn(),
}))

/** 渲染并等到「已登录、停在选择测评对象」这一步；后续用例各自决定往哪走 */
async function renderSignedIn() {
  vi.mocked(fetchMe).mockResolvedValue({ id: 'u1', username: 'tester' })
  render(<App />)
  await screen.findByRole('button', { name: '测测自己' })
}

beforeEach(() => {
  vi.mocked(fetchMe).mockReset()
  vi.mocked(fetchQuestions).mockReset()
  vi.mocked(postDiagnose).mockReset()
})

describe('App · 登录门槛（spec §4.3）', () => {
  it('未登录时渲染登录页，不直接进问卷', async () => {
    vi.mocked(fetchMe).mockResolvedValue(null)
    render(<App />)
    expect(await screen.findByRole('button', { name: '登录' })).toBeInTheDocument()
  })
})

describe('App · 我的历史（spec §5.1）', () => {
  it('从首页进历史列表，点一条能看到完整结果与存下来的解读', async () => {
    vi.mocked(fetchAssessments).mockResolvedValue([{
      id: 'a1', source: 'self', grade: 'freshman', createdAt: '2026-02-01T00:00:00.000Z',
      mainPathId: 'same-discipline-baoyan', mainPathTitle: '本学科保研', match: 55,
    }])
    vi.mocked(fetchAssessment).mockResolvedValue({
      id: 'a1', source: 'self', grade: 'freshman', createdAt: '2026-02-01T00:00:00.000Z',
      answers: { q1: 4 },
      result: {
        indicators: {},
        paths: [{
          id: 'same-discipline-baoyan', match: 55, confidence: 0.8,
          eligibility: { applicable: true, hardFailures: [], softWarnings: [] },
          contributions: [],
        }],
        archetypes: [],
      },
      interpretation: '存下来的解读',
      mainPathId: 'same-discipline-baoyan',
      tiedPaths: ['same-discipline-baoyan'],
      paths: [{
        id: 'same-discipline-baoyan', title: '本学科保研', category: 'academic',
        span: 'same-discipline', status: 'verified', summary: '',
      }],
    })

    await renderSignedIn()
    await userEvent.click(screen.getByRole('button', { name: '我的历史' }))
    await userEvent.click(await screen.findByText('测测自己'))

    expect(await screen.findByText('存下来的解读')).toBeInTheDocument()
    expect(screen.getByText(/匹配度 55/)).toBeInTheDocument()
  })
})

describe('App · 信息不足（设计文档 §10）', () => {
  it('没有可作答题目时给出显式提示，而不是让用户提交后撞 400', async () => {
    vi.mocked(fetchQuestions).mockResolvedValue({ questions: [], indicators: [], paths: [] })
    await renderSignedIn()

    await userEvent.click(screen.getByRole('button', { name: '测测自己' }))
    await userEvent.click(screen.getByRole('button', { name: '大一' }))

    expect(await screen.findByText(/信息不足/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /提交/ })).not.toBeInTheDocument()
    expect(postDiagnose).not.toHaveBeenCalled()
  })
})

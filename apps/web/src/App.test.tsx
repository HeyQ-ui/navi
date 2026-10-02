import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fetchMe, fetchQuestions, postDiagnose } from './api.js'
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

/** 走到「已登录 + 已选测评对象」这一步，后续用例从这里开始 */
async function signIn() {
  vi.mocked(fetchMe).mockResolvedValue({ id: 'u1', username: 'tester' })
  render(<App />)
  await userEvent.click(await screen.findByRole('button', { name: '测测自己' }))
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

describe('App · 信息不足（设计文档 §10）', () => {
  it('没有可作答题目时给出显式提示，而不是让用户提交后撞 400', async () => {
    vi.mocked(fetchQuestions).mockResolvedValue({ questions: [], indicators: [], paths: [] })
    await signIn()

    await userEvent.click(screen.getByRole('button', { name: '大一' }))

    expect(await screen.findByText(/信息不足/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /提交/ })).not.toBeInTheDocument()
    expect(postDiagnose).not.toHaveBeenCalled()
  })
})

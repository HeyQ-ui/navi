import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fetchQuestions, postDiagnose } from './api.js'
import { App } from './App.js'

vi.mock('./api.js', () => ({
  fetchQuestions: vi.fn(),
  postDiagnose: vi.fn(),
}))

describe('App · 信息不足（设计文档 §10）', () => {
  beforeEach(() => {
    vi.mocked(fetchQuestions).mockReset()
    vi.mocked(postDiagnose).mockReset()
  })

  it('没有可作答题目时给出显式提示，而不是让用户提交后撞 400', async () => {
    vi.mocked(fetchQuestions).mockResolvedValue({ questions: [], indicators: [], paths: [] })
    render(<App />)

    await userEvent.click(screen.getByRole('button', { name: '大一' }))

    expect(await screen.findByText(/信息不足/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /提交/ })).not.toBeInTheDocument()
    expect(postDiagnose).not.toHaveBeenCalled()
  })
})

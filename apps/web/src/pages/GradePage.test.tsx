import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fetchMe, fetchQuestions } from '../api.js'
import { FlowProvider } from '../state.js'
import { GradePage } from './GradePage.js'

vi.mock('../api.js', async () => {
  const actual = await vi.importActual<typeof import('../api.js')>('../api.js')
  return {
    ...actual,
    fetchMe: vi.fn(), fetchQuestions: vi.fn(), authenticate: vi.fn(), logout: vi.fn(), fetchMeta: vi.fn(),
  }
})

function renderGrade() {
  return render(<FlowProvider><GradePage /></FlowProvider>)
}

const oneQuestion = {
  questions: [{ id: 'q1', text: 't', options: ['a'], weight: 1 }],
  indicators: [], paths: [],
}

beforeEach(() => {
  window.history.pushState({}, '', '/grade')
  vi.mocked(fetchMe).mockResolvedValue(null)
})

describe('GradePage', () => {
  it('选定年级且题目非空时进入问卷', async () => {
    vi.mocked(fetchQuestions).mockResolvedValue(oneQuestion)
    renderGrade()
    await userEvent.click(await screen.findByRole('button', { name: '大一' }))
    await waitFor(() => expect(window.location.pathname).toBe('/quiz'))
  })

  it('没有可作答题目时显示「信息不足」，不让用户去撞 400（契约延续）', async () => {
    vi.mocked(fetchQuestions).mockResolvedValue({ questions: [], indicators: [], paths: [] })
    renderGrade()
    await userEvent.click(await screen.findByRole('button', { name: '大一' }))
    expect(await screen.findByText(/信息不足/)).toBeInTheDocument()
    expect(window.location.pathname).toBe('/grade')
  })

  it('取题失败时内联错误，重试成功后照常进入问卷', async () => {
    vi.mocked(fetchQuestions).mockRejectedValueOnce(new Error('获取问卷失败：500'))
    renderGrade()
    await userEvent.click(await screen.findByRole('button', { name: '大一' }))
    expect(await screen.findByText('获取问卷失败：500')).toBeInTheDocument()

    vi.mocked(fetchQuestions).mockResolvedValueOnce(oneQuestion)
    await userEvent.click(screen.getByRole('button', { name: '重试' }))
    await waitFor(() => expect(window.location.pathname).toBe('/quiz'))
  })
})

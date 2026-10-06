import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fetchMe, fetchQuestions, postDiagnose } from '../api.js'
import { ApiHttpError } from '../api.js'
import { FlowProvider, useFlow } from '../state.js'
import { QuizPage } from './QuizPage.js'

vi.mock('../api.js', async () => {
  const actual = await vi.importActual<typeof import('../api.js')>('../api.js')
  return {
    ...actual,
    fetchMe: vi.fn(), fetchQuestions: vi.fn(), postDiagnose: vi.fn(),
    authenticate: vi.fn(), logout: vi.fn(), fetchMeta: vi.fn(),
  }
})

// 6 题 = 两组（5 + 1），覆盖「上一组 / 下一组」与组间必答门槛
const questions = Array.from({ length: 6 }, (_, i) => ({
  id: `q${i + 1}`, text: `题目${i + 1}`, options: ['甲', '乙'], weight: 1,
}))

/** 问卷页只读 state 里的题目——测试用这个探针先把题目装进去 */
function LoadProbe() {
  const flow = useFlow()
  return (
    <button type="button" onClick={() => void flow.chooseGrade('freshman')}>装填题目</button>
  )
}

function renderQuiz() {
  return render(<FlowProvider><QuizPage /><LoadProbe /></FlowProvider>)
}

async function setupQuiz() {
  vi.mocked(fetchQuestions).mockResolvedValue({ questions, indicators: [], paths: [] })
  renderQuiz()
  await userEvent.click(await screen.findByRole('button', { name: '装填题目' }))
  await screen.findByText('题目1')
}

beforeEach(() => {
  window.history.pushState({}, '', '/quiz')
  vi.mocked(fetchMe).mockResolvedValue({ id: 'u1', username: 'tester' })
  vi.mocked(postDiagnose).mockResolvedValue({
    indicators: {}, paths: [], archetypes: [], tiedPaths: [], assessmentId: 'a1',
  })
})

describe('QuizPage', () => {
  it('没有答题上下文直接访问 /quiz 时回首页（状态守卫，spec §4.2）', async () => {
    renderQuiz()
    await waitFor(() => expect(window.location.pathname).toBe('/'))
  })

  it('本组未答满不能前进，答满才能下一组（契约延续）', async () => {
    await setupQuiz()
    const next = screen.getByRole('button', { name: '下一组' })
    expect(next).toBeDisabled()
    for (let i = 0; i < 5; i++) {
      await userEvent.click(screen.getAllByText('甲')[i]!)
    }
    expect(next).toBeEnabled()
  })

  it('全部答完后提交，回传选项索引并进入结果页（契约延续）', async () => {
    await setupQuiz()
    for (let i = 0; i < 5; i++) {
      await userEvent.click(screen.getAllByText('甲')[i]!)
    }
    await userEvent.click(screen.getByRole('button', { name: '下一组' }))
    await userEvent.click(screen.getByText('乙'))
    await userEvent.click(screen.getByRole('button', { name: '提交' }))
    await waitFor(() => expect(window.location.pathname).toBe('/result'))
    expect(vi.mocked(postDiagnose)).toHaveBeenCalledWith(
      { q1: 0, q2: 0, q3: 0, q4: 0, q5: 0, q6: 1 }, 'freshman', 'self',
    )
  })

  it('提交撞 401（会话中途失效）去登录，不重新答题（spec §4.2）', async () => {
    await setupQuiz()
    vi.mocked(postDiagnose).mockRejectedValue(new ApiHttpError('未登录', 401))
    for (let i = 0; i < 5; i++) {
      await userEvent.click(screen.getAllByText('甲')[i]!)
    }
    await userEvent.click(screen.getByRole('button', { name: '下一组' }))
    await userEvent.click(screen.getByText('乙'))
    await userEvent.click(screen.getByRole('button', { name: '提交' }))
    await waitFor(() => expect(window.location.pathname).toBe('/auth'))
  })
})

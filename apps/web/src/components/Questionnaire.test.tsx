import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Questionnaire } from './Questionnaire.js'
import type { Question } from '../api.js'

const questions: Question[] = [
  { id: 'q1', indicator: 'academic-interest', text: '第一题题干', options: ['A','B','C','D','E'], weight: 1 },
  { id: 'q2', indicator: 'academic-interest', text: '第二题题干', options: ['A','B','C','D','E'], weight: 1 },
]

describe('Questionnaire', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('渲染题目与五个选项', () => {
    render(<Questionnaire questions={questions} onSubmit={() => {}} />)
    expect(screen.getByText('第一题题干')).toBeInTheDocument()
    expect(screen.getAllByRole('radio')).toHaveLength(10)
  })

  it('未答完时提交按钮禁用', () => {
    render(<Questionnaire questions={questions} onSubmit={() => {}} />)
    expect(screen.getByRole('button', { name: /提交/ })).toBeDisabled()
  })

  it('全部作答后提交按钮可用，并回传选项索引', async () => {
    const onSubmit = vi.fn()
    render(<Questionnaire questions={questions} onSubmit={onSubmit} />)

    const radios = screen.getAllByRole('radio')
    await userEvent.click(radios[0]!)
    await userEvent.click(radios[6]!)

    const submit = screen.getByRole('button', { name: /提交/ })
    expect(submit).toBeEnabled()
    await userEvent.click(submit)

    expect(onSubmit).toHaveBeenCalledWith({ q1: 0, q2: 1 })
  })

  it('显示已完成题数', async () => {
    render(<Questionnaire questions={questions} onSubmit={() => {}} />)
    expect(screen.getByText(/0\s*\/\s*2/)).toBeInTheDocument()
    await userEvent.click(screen.getAllByRole('radio')[0]!)
    expect(screen.getByText(/1\s*\/\s*2/)).toBeInTheDocument()
  })

  it('答案写入 localStorage，重新挂载后恢复（设计文档 §5.5）', async () => {
    const first = render(<Questionnaire questions={questions} onSubmit={() => {}} />)
    await userEvent.click(screen.getAllByRole('radio')[0]!)
    first.unmount()

    render(<Questionnaire questions={questions} onSubmit={() => {}} />)
    expect(screen.getByText(/1\s*\/\s*2/)).toBeInTheDocument()
  })

  it('暂存里已不存在的题目 id 会被丢弃（删过题的客户端不该带着旧作答提交）', async () => {
    localStorage.setItem(
      'navi.questionnaire.answers',
      JSON.stringify({ 'gone-1': 0, q1: 0 }),
    )
    const onSubmit = vi.fn()
    render(<Questionnaire questions={questions} onSubmit={onSubmit} />)

    // gone-1 不计入「已完成」，否则提交按钮会在第二题还没答时就亮起来
    expect(screen.getByText(/1\s*\/\s*2/)).toBeInTheDocument()

    await userEvent.click(screen.getAllByRole('radio')[5]!)
    await userEvent.click(screen.getByRole('button', { name: /提交/ }))

    expect(onSubmit).toHaveBeenCalledWith({ q1: 0, q2: 0 })
  })

  it('localStorage 内容损坏时不影响渲染，按空白问卷处理', () => {
    localStorage.setItem('navi.questionnaire.answers', '{不是合法 JSON')
    expect(() => render(<Questionnaire questions={questions} onSubmit={() => {}} />)).not.toThrow()
    expect(screen.getByText(/0\s*\/\s*2/)).toBeInTheDocument()
  })
})

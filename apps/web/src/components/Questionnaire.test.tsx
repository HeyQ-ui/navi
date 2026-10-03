import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Questionnaire } from './Questionnaire.js'
import type { Question } from '../api.js'

const questions: Question[] = [
  { id: 'q1', indicator: 'academic-interest', text: '第一题题干', options: ['A','B','C','D','E'], weight: 1 },
  { id: 'q2', indicator: 'academic-interest', text: '第二题题干', options: ['A','B','C','D','E'], weight: 1 },
]

describe('Questionnaire', () => {
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

  it('重新进入一套测试时从空白开始，不继承上一次的选择', async () => {
    const first = render(<Questionnaire questions={questions} onSubmit={() => {}} />)
    await userEvent.click(screen.getAllByRole('radio')[0]!)
    expect(screen.getByText(/1\s*\/\s*2/)).toBeInTheDocument()
    first.unmount()

    render(<Questionnaire questions={questions} onSubmit={() => {}} />)
    expect(screen.getByText(/0\s*\/\s*2/)).toBeInTheDocument()
    expect(screen.getAllByRole('radio').some(radio => (radio as HTMLInputElement).checked)).toBe(false)
  })
})

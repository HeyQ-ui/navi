import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { History } from './History.js'

beforeEach(() => { vi.restoreAllMocks() })

const rows = [
  { id: 'a1', source: 'self', grade: 'freshman', createdAt: '2026-02-01T00:00:00.000Z',
    mainPathId: 'same-discipline-baoyan', mainPathTitle: '本学科保研', match: 55 },
  { id: 'a2', source: 'other', grade: 'sophomore', createdAt: '2026-01-01T00:00:00.000Z',
    mainPathId: 'same-discipline-kaoyan', mainPathTitle: '本学科考研', match: 48 },
]

describe('History', () => {
  it('列出历次测评，标出测的是谁，主推荐路径显示中文名', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ assessments: rows }), { status: 200 }),
    )
    render(<History onOpen={() => {}} />)

    expect(await screen.findByText('测测自己')).toBeInTheDocument()
    expect(screen.getByText('测测别人')).toBeInTheDocument()
    expect(screen.getByText(/本学科保研/)).toBeInTheDocument()
  })

  it('列表为空时给出空态而不是空白', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ assessments: [] }), { status: 200 }),
    )
    render(<History onOpen={() => {}} />)
    expect(await screen.findByText('还没有测评记录')).toBeInTheDocument()
  })

  it('点某一条时把 id 交给上层', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ assessments: rows }), { status: 200 }),
    )
    const onOpen = vi.fn()
    render(<History onOpen={onOpen} />)
    await userEvent.click(await screen.findByText('测测自己'))
    expect(onOpen).toHaveBeenCalledWith('a1')
  })

  it('加载失败时显示错误而不是一直停在加载中', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: '未登录' }), { status: 401 }),
    )
    render(<History onOpen={() => {}} />)
    expect(await screen.findByText('未登录')).toBeInTheDocument()
  })
})

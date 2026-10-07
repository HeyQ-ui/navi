import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PathRow } from './PathRow.js'
import type { PathRowData } from './PathRow.js'

function renderRow(data: PathRowData) {
  return render(<ul><PathRow data={data} /></ul>)
}

describe('PathRow', () => {
  it('结果态：渲染匹配条与匹配分，整行指向路径详情', () => {
    const { container } = renderRow({
      id: 'same-discipline-baoyan', title: '本学科保研', status: 'verified',
      match: 78, applicable: true,
    })
    const link = screen.getByRole('link', { name: /本学科保研/ })
    expect(link).toHaveAttribute('href', '/path/same-discipline-baoyan')
    expect(link).toHaveTextContent('78')
    expect(container.querySelector('.bg-ink-3')).not.toBeNull()
  })

  it('浏览态：没有匹配分时不渲染匹配条与分数——不拿空条或 0 分充数（spec §5.8）', () => {
    const { container } = renderRow({
      id: 'same-discipline-baoyan', title: '本学科保研', status: 'verified',
    })
    // 行的可访问名含行尾的 ›，所以用正则匹配而不是精确串
    const link = screen.getByRole('link', { name: /本学科保研/ })
    expect(link).toHaveTextContent('本学科保研')
    expect(link.querySelector('.bg-ink-3')).toBeNull()
    expect(container.querySelector('.bg-line')).toBeNull()
  })

  it('draft 路径带待核实角标（spec §3.6）', () => {
    renderRow({ id: 'a', title: '本学科考研', status: 'draft' })
    expect(screen.getByText('待核实')).toBeInTheDocument()
  })

  it('verified 路径不带任何角标（spec §3.6）', () => {
    renderRow({ id: 'a', title: '本学科考研', status: 'verified' })
    expect(screen.queryByText('待核实')).not.toBeInTheDocument()
  })

  it('不适用路径置灰并逐条列出原因（主文档 §7.4）', () => {
    const { container } = renderRow({
      id: 'civil-service', title: '考公考编', status: 'verified',
      match: 12, applicable: false,
      hardFailures: [{ id: 'f1', severity: 'hard', message: '需要党员身份' }],
    })
    expect(screen.getByText('不适用：需要党员身份')).toBeInTheDocument()
    expect(container.querySelector('.opacity-55')).not.toBeNull()
  })

  it('带来源标记时 href 带上 from，供详情页把返回链指回来源页（spec §5.6）', () => {
    renderRow({
      id: 'same-discipline-baoyan', title: '本学科保研', status: 'verified',
      from: 'paths',
    })
    expect(screen.getByRole('link', { name: /本学科保研/ }))
      .toHaveAttribute('href', '/path/same-discipline-baoyan?from=paths')
  })
})

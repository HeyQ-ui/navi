import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StatusBadge } from './StatusBadge.js'

describe('StatusBadge（前端重设计 spec §3.6）', () => {
  it('draft 与 review 显示待核实', () => {
    render(<StatusBadge status="draft" />)
    render(<StatusBadge status="review" />)
    expect(screen.getAllByText('待核实')).toHaveLength(2)
  })

  it('verified 不渲染任何角标——已核实是常态，不做正向展示', () => {
    const { container } = render(<StatusBadge status="verified" />)
    expect(container).toBeEmptyDOMElement()
  })
})

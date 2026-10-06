import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { Block } from '@navi/core'
import { BlockRenderer } from './BlockRenderer.js'

const timelineHtml = `<h2>本学科保研时间线</h2>
<ul>
<li><strong>大一上 · 12月</strong> 四级考试</li>
<li><strong>大一下 · 6月</strong> 六级考试</li>
<li><strong>大二上</strong> 奖学金评定</li>
</ul>`

function block(partial: Partial<Block> & { type: string }): Block {
  return { html: '', raw: '', ...partial }
}

describe('BlockRenderer · 时间线', () => {
  it('逐条渲染，当前年级的首条带「现在」标记', () => {
    render(<BlockRenderer blocks={[block({ type: 'timeline', html: timelineHtml })]} grade="sophomore" />)
    expect(screen.getByText('四级考试')).toBeInTheDocument()
    const now = screen.getByText('现在')
    // 「现在」挂在「大二上」那条上：同一条目内
    expect(now.closest('li')!.textContent).toContain('奖学金评定')
  })

  it('大一进来时「现在」落在第一条', () => {
    render(<BlockRenderer blocks={[block({ type: 'timeline', html: timelineHtml })]} grade="freshman" />)
    expect(screen.getByText('现在').closest('li')!.textContent).toContain('四级考试')
  })

  it('没有年级（直接进入详情页）时不显示「现在」', () => {
    render(<BlockRenderer blocks={[block({ type: 'timeline', html: timelineHtml })]} grade={null} />)
    expect(screen.queryByText('现在')).not.toBeInTheDocument()
  })

  it('时间线无 li 可解析时降级为富文本，页面不崩', () => {
    render(<BlockRenderer blocks={[block({ type: 'timeline', html: '<p>一段话</p>' })]} grade="freshman" />)
    expect(screen.getByText('一段话')).toBeInTheDocument()
  })
})

describe('BlockRenderer · 行动指南', () => {
  it('strong 前缀作为时段列，其余作为行动列', () => {
    render(
      <BlockRenderer
        blocks={[block({ type: 'guide', title: '分时段行动建议', html: '<ul><li><strong>大一上</strong> 读懂推免办法</li></ul>' })]}
        grade={null}
      />,
    )
    expect(screen.getByText('分时段行动建议')).toBeInTheDocument()
    expect(screen.getByText('大一上')).toBeInTheDocument()
    expect(screen.getByText('读懂推免办法')).toBeInTheDocument()
  })
})

describe('BlockRenderer · 语义芯片与降级', () => {
  it('误区/代价/风险各带语义芯片', () => {
    render(
      <BlockRenderer
        blocks={[
          block({ type: 'myth', title: '排名前 10% 就稳了', html: '<p>纠正</p>' }),
          block({ type: 'cost', title: '需要放弃', html: '<ul><li>一些东西</li></ul>' }),
          block({ type: 'risk', title: '这条路的风险', html: '<ul><li>一个风险</li></ul>' }),
        ]}
        grade={null}
      />,
    )
    expect(screen.getByText('误区')).toBeInTheDocument()
    expect(screen.getByText('代价')).toBeInTheDocument()
    expect(screen.getByText('风险')).toBeInTheDocument()
  })

  it('未识别块类型降级为富文本渲染（硬性约束 3）', () => {
    render(
      <BlockRenderer
        blocks={[block({ type: 'brand-new-type', title: '新块', html: '<p>照常显示</p>' })]}
        grade={null}
      />,
    )
    expect(screen.getByText('照常显示')).toBeInTheDocument()
    expect(screen.getByText('新块')).toBeInTheDocument()
  })
})

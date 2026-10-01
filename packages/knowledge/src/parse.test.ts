import { describe, it, expect } from 'vitest'
import { parseFrontmatter, parseBlocks } from './parse.js'

describe('parseFrontmatter', () => {
  it('解析 YAML frontmatter 并分离正文', () => {
    const raw = `---
id: same-discipline-baoyan
title: 本学科保研
status: verified
---
## 正文标题
内容`
    const { data, content } = parseFrontmatter(raw)
    expect(data.id).toBe('same-discipline-baoyan')
    expect(data.title).toBe('本学科保研')
    expect(data.status).toBe('verified')
    expect(content.trim().startsWith('## 正文标题')).toBe(true)
  })

  it('无 frontmatter 时返回空对象与原文', () => {
    const { data, content } = parseFrontmatter('## 只有正文')
    expect(data).toEqual({})
    expect(content).toBe('## 只有正文')
  })
})

describe('parseBlocks', () => {
  it('按 @block 注解切分并渲染为 HTML', () => {
    const content = `<!-- @block type="timeline" -->
## 保研时间线
- 大三上 · 9月 排名公示

<!-- @block type="myth" -->
:::myth 排名前 10% 就稳了
绩点只是入场券。
:::`
    const blocks = parseBlocks(content)
    expect(blocks).toHaveLength(2)
    expect(blocks[0]!.type).toBe('timeline')
    expect(blocks[0]!.html).toContain('保研时间线')
    expect(blocks[1]!.type).toBe('myth')
    expect(blocks[1]!.html).toContain('绩点只是入场券')
  })

  it('未识别的块类型同样被保留，不抛错', () => {
    const content = `<!-- @block type="brand-new-type" -->
## 新内容
正文`
    const blocks = parseBlocks(content)
    expect(blocks).toHaveLength(1)
    expect(blocks[0]!.type).toBe('brand-new-type')
  })

  it('没有 @block 注解的内容归入 free 类型', () => {
    const blocks = parseBlocks('## 零散观察\n随便写点什么')
    expect(blocks).toHaveLength(1)
    expect(blocks[0]!.type).toBe('free')
  })
})

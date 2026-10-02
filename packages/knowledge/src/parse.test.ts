import { describe, it, expect } from 'vitest'
import { parseFrontmatter, parseBlocks, parseContainers } from './parse.js'

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

describe('parseContainers', () => {
  it('按 ::: 容器逐条成块，raw 里不留字面标记，参数进 title', () => {
    const blocks = parseContainers(`:::boundary topic="转专业政策"
各校政策每年都可能调整，我们无法给出可靠建议。
:::

:::boundary topic="分数线预测"
我们不预测任何学校的录取分数。
:::`)

    expect(blocks).toHaveLength(2)
    expect(blocks[0]!.type).toBe('boundary')
    expect(blocks[0]!.title).toBe('topic="转专业政策"')
    expect(blocks[0]!.raw).toBe('各校政策每年都可能调整，我们无法给出可靠建议。')
    expect(blocks[0]!.html).toContain('我们无法给出可靠建议')
    expect(blocks[1]!.type).toBe('boundary')
    expect(blocks[1]!.raw).not.toContain(':::')
  })

  it('不带参数的容器不设 title（§6.3 不强制字段）', () => {
    expect(parseContainers(':::cost\n需要放弃一些东西\n:::')[0]!.title).toBeUndefined()
  })

  it('容器未闭合时不抛错，按已收集内容成块', () => {
    const blocks = parseContainers(':::myth 没闭合\n正文')
    expect(blocks).toHaveLength(1)
    expect(blocks[0]!.type).toBe('myth')
    expect(blocks[0]!.raw).toBe('正文')
  })

  it('容器之外的零散文本不进入任何块', () => {
    const blocks = parseContainers('散落的一行\n:::cost\n正文\n:::')
    expect(blocks).toHaveLength(1)
    expect(blocks[0]!.raw).toBe('正文')
  })
})

describe('parseBlocks · 容器标记不外泄（设计文档 §6.3 第 4 条）', () => {
  it('剥掉 ::: 标记，标题进 title，raw 与 html 里都不留标记', () => {
    const blocks = parseBlocks(`<!-- @block type="myth" -->
:::myth 排名前 10% 就稳了
绩点只是入场券。
:::

<!-- @block type="cost" -->
:::cost 选择保研，需要放弃
- 大三暑期无法参加实习
:::`)

    expect(blocks).toHaveLength(2)
    expect(blocks[0]!.title).toBe('排名前 10% 就稳了')
    expect(blocks[0]!.raw).toBe('绩点只是入场券。')
    expect(blocks[0]!.html).not.toContain(':::')
    expect(blocks[1]!.title).toBe('选择保研，需要放弃')
    expect(blocks[1]!.raw).toBe('- 大三暑期无法参加实习')
    expect(blocks[1]!.html).not.toContain(':::')
  })

  it('不带标题的容器不设 title', () => {
    const blocks = parseBlocks('<!-- @block type="cost" -->\n:::cost\n要放弃一些东西\n:::')
    expect(blocks[0]!.title).toBeUndefined()
    expect(blocks[0]!.raw).toBe('要放弃一些东西')
  })

  it('不是容器的正文原样保留（timeline 用的是 markdown 标题）', () => {
    const blocks = parseBlocks('<!-- @block type="timeline" -->\n## 保研时间线\n- 大三上 · 9月 排名公示')
    expect(blocks[0]!.title).toBeUndefined()
    expect(blocks[0]!.raw).toContain('## 保研时间线')
  })

  it('容器未闭合时仍剥掉标记行，不吞内容', () => {
    const blocks = parseBlocks('<!-- @block type="myth" -->\n:::myth 没闭合\n正文')
    expect(blocks[0]!.title).toBe('没闭合')
    expect(blocks[0]!.raw).toBe('正文')
  })

  it('容器类型与 @block 不一致时以 @block 为准', () => {
    const blocks = parseBlocks('<!-- @block type="myth" -->\n:::cost 混了\n正文\n:::')
    expect(blocks[0]!.type).toBe('myth')
  })
})

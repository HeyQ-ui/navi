import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { buildKnowledge } from './build.js'

let roots: string[] = []

function makeTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'navi-knowledge-'))
  roots.push(root)
  return root
}

/** 造一个只含 paths/ 的知识库根目录。目录名顺序与 id 顺序刻意无关 */
function makeRoot(dirs: Array<[dirName: string, id: string]>): string {
  const root = makeTempRoot()
  for (const [dirName, id] of dirs) {
    mkdirSync(join(root, 'paths', dirName), { recursive: true })
    writeFileSync(
      join(root, 'paths', dirName, 'index.md'),
      `---\nid: ${id}\ntitle: ${id}\n---\n\n正文\n`,
      'utf8',
    )
  }
  return root
}

afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
  roots = []
})

describe('buildKnowledge', () => {
  it('路径按 id 排序，不依赖目录的枚举顺序', () => {
    const root = makeRoot([['p-a', 'zeta-path'], ['p-b', 'alpha-path']])
    const bundle = buildKnowledge(root)
    expect(bundle.paths.map(p => p.id)).toEqual(['alpha-path', 'zeta-path'])
  })

  it('同一目录重复编译得到完全一致的产物', () => {
    const root = makeRoot([['p-a', 'zeta-path'], ['p-b', 'alpha-path']])
    expect(JSON.stringify(buildKnowledge(root))).toBe(JSON.stringify(buildKnowledge(root)))
  })

  it('rootDir 为空目录时返回空结构而不是崩溃', () => {
    const bundle = buildKnowledge(makeTempRoot())
    expect(bundle.paths).toEqual([])
    expect(bundle.indicators).toEqual([])
    expect(bundle.archetypes).toEqual([])
    expect(bundle.common).toEqual([])
  })
})

describe('buildKnowledge · 诚实边界', () => {
  it('根目录没有 boundaries.md 时返回空数组', () => {
    expect(buildKnowledge(makeTempRoot()).boundaries).toEqual([])
  })

  it('解析 boundaries.md 为逐条 boundary 块，raw 里不带字面 :::', () => {
    const root = makeTempRoot()
    writeFileSync(
      join(root, 'boundaries.md'),
      ':::boundary topic="转专业政策"\n我们无法给出可靠建议。\n:::\n',
      'utf8',
    )
    const blocks = buildKnowledge(root).boundaries
    expect(blocks).toHaveLength(1)
    expect(blocks[0]!.type).toBe('boundary')
    expect(blocks[0]!.title).toBe('topic="转专业政策"')
    expect(blocks[0]!.raw).toBe('我们无法给出可靠建议。')
  })

  it('真实的 boundaries.md 解析出三条 boundary 块（防止将来退化时无人报警）', () => {
    const blocks = buildKnowledge().boundaries
    expect(blocks).toHaveLength(3)
    expect(blocks.every(b => b.type === 'boundary')).toBe(true)
    expect(blocks.map(b => b.title)).toEqual([
      'topic="转专业政策"',
      'topic="院校录取分数线预测"',
      'topic="考试时间节点的年度差异"',
    ])
    expect(blocks.every(b => !b.raw.includes(':::'))).toBe(true)
  })
})

describe('buildKnowledge · 路径文档的标记不外泄（设计文档 §6.3 第 4 条）', () => {
  it('真实路径文档的块里不含字面 :::', () => {
    const all = Object.values(buildKnowledge().blocks).flat()
    expect(all.length).toBeGreaterThan(0)
    expect(all.filter(b => b.raw.includes(':::') || b.html.includes(':::'))).toEqual([])
  })

  it('真实路径文档的 myth / cost 块带上了容器标题', () => {
    const blocks = buildKnowledge().blocks['same-discipline-baoyan']!
    const myth = blocks.find(b => b.type === 'myth')!
    const cost = blocks.find(b => b.type === 'cost')!
    expect(myth.title).toBe('排名前 10% 就稳了')
    expect(cost.title).toBe('选择保研，需要放弃')
  })
})

describe('buildKnowledge · 路径文档的块结构（设计文档 §6.3 v1.5）', () => {
  it('本学科保研：timeline / guide / myth / cost / risk 齐备且顺序固定', () => {
    const blocks = buildKnowledge().blocks['same-discipline-baoyan']!
    expect(blocks.map(b => b.type)).toEqual(['timeline', 'guide', 'myth', 'cost', 'risk'])
    expect(blocks.find(b => b.type === 'guide')!.title).toBe('分时段行动建议')
    expect(blocks.find(b => b.type === 'risk')!.title).toBe('这条路的风险')
  })

  it('本学科考研：timeline / guide / myth / cost / risk 齐备且顺序固定', () => {
    const blocks = buildKnowledge().blocks['same-discipline-kaoyan']!
    expect(blocks.map(b => b.type)).toEqual(['timeline', 'guide', 'myth', 'cost', 'risk'])
  })

  it('跨学科保研：没有 cost 块也不影响其余块（块类型契约不强制字段）', () => {
    const blocks = buildKnowledge().blocks['cross-discipline-baoyan']!
    expect(blocks.map(b => b.type)).toEqual(['timeline', 'guide', 'myth', 'myth', 'risk'])
    expect(blocks.filter(b => b.type === 'myth')).toHaveLength(2)
  })

  it('跨学科考研：timeline / guide / myth / cost / risk 齐备且顺序固定', () => {
    const blocks = buildKnowledge().blocks['cross-discipline-kaoyan']!
    expect(blocks.map(b => b.type)).toEqual(['timeline', 'guide', 'myth', 'cost', 'risk'])
  })

  it('考公考编：timeline / guide / myth / cost / risk 齐备且顺序固定', () => {
    const blocks = buildKnowledge().blocks['civil-service']!
    expect(blocks.map(b => b.type)).toEqual(['timeline', 'guide', 'myth', 'cost', 'risk'])
  })

  it('本学科就业：timeline / guide / cost / risk，且已无 myth（v1.6）', () => {
    const blocks = buildKnowledge().blocks['same-discipline-job']!
    expect(blocks.map(b => b.type)).toEqual(['timeline', 'guide', 'cost', 'risk'])
  })

  it('跨学科就业：timeline / guide / cost / risk，且已无 myth（v1.6）', () => {
    const blocks = buildKnowledge().blocks['cross-discipline-job']!
    expect(blocks.map(b => b.type)).toEqual(['timeline', 'guide', 'cost', 'risk'])
  })

  it('跨学科就业的时间线延伸到择业期，多这一行不丢内容（Review Focus 1）', () => {
    const timeline = buildKnowledge().blocks['cross-discipline-job']!
      .find(b => b.type === 'timeline')!
    expect(timeline.raw).toContain('毕业后')
    expect(timeline.raw).toContain('择业期')
  })
})

describe('buildKnowledge · 通用知识（设计文档 §6.1 v1.5）', () => {
  it('根目录没有 common.md 时返回空数组', () => {
    expect(buildKnowledge(makeTempRoot()).common).toEqual([])
  })

  it('解析 common.md 为逐条容器块，raw 里不带字面 :::', () => {
    const root = makeTempRoot()
    writeFileSync(
      join(root, 'common.md'),
      ':::myth 目标真空\n随大流决定考研或考公。\n:::\n\n:::compare 差异对比\n| A | B |\n|---|---|\n| 1 | 2 |\n:::\n',
      'utf8',
    )
    const blocks = buildKnowledge(root).common
    expect(blocks.map(b => b.type)).toEqual(['myth', 'compare'])
    expect(blocks[0]!.title).toBe('目标真空')
    expect(blocks[0]!.raw).toBe('随大流决定考研或考公。')
    expect(blocks[1]!.raw).toContain('| 1 | 2 |')
    expect(blocks.every(b => !b.raw.includes(':::') && !b.html.includes(':::'))).toBe(true)
  })

  it('内容侧写了一个全新块类型时不报错、不丢弃', () => {
    const root = makeTempRoot()
    writeFileSync(join(root, 'common.md'), ':::case 某个案例\n正文\n:::\n', 'utf8')
    const blocks = buildKnowledge(root).common
    expect(blocks).toHaveLength(1)
    expect(blocks[0]!.type).toBe('case')
    expect(blocks[0]!.raw).toBe('正文')
  })

  it('真实的 common.md 解析出 7 条误区 + 2 张对比表（防止将来退化时无人报警）', () => {
    const blocks = buildKnowledge().common
    expect(blocks.filter(b => b.type === 'myth')).toHaveLength(7)
    expect(blocks.filter(b => b.type === 'compare')).toHaveLength(2)
    expect(blocks.every(b => b.title !== undefined)).toBe(true)
    expect(blocks.every(b => !b.raw.includes(':::'))).toBe(true)
  })

  it('对比表覆盖全部七条路径，不再声明「就业未纳入对比」', () => {
    const [diff] = buildKnowledge().common.filter(b => b.type === 'compare')
    for (const title of [
      '本学科保研', '本学科考研', '跨学科保研', '跨学科考研', '考公考编', '本学科就业', '跨学科就业',
    ]) {
      expect(diff!.raw, title).toContain(title)
    }
    expect(diff!.raw).not.toContain('未纳入对比')
  })

  it('第 7 条误区是「就业准备误区」，与两条路径移除的 myth 内容对应', () => {
    const myths = buildKnowledge().common.filter(b => b.type === 'myth')
    expect(myths.map(b => b.title)).toContain('就业准备误区')
    const block = myths.find(b => b.title === '就业准备误区')!
    expect(block.raw).toContain('找工作是大四的事')
    expect(block.raw).toContain('专业不对口')
  })

  it('对比表完整落进 raw，Markdown 表格行不被当成容器边界', () => {
    const tables = buildKnowledge().common.filter(b => b.type === 'compare')
    // 先断言数量：没有这一条，common 为空时 for 循环空转，这个测试永远不会失败
    expect(tables).toHaveLength(2)
    for (const t of tables) {
      expect(t.raw).toContain('|---')
      expect(t.html).toContain('<table>')
    }
  })
})

describe('buildKnowledge · 参考文献（前端重设计 spec §5.9）', () => {
  it('根目录没有 references.md 时返回空数组', () => {
    expect(buildKnowledge(makeTempRoot()).references).toEqual([])
  })

  it('解析 references.md 为 references 块，raw 里不带字面 :::', () => {
    const root = makeTempRoot()
    writeFileSync(
      join(root, 'references.md'),
      ':::references\n| # | 题录 | 来源 |\n|---|---|---|\n| 1 | 某论文 | [来源](http://example.com/a) |\n:::\n',
      'utf8',
    )
    const blocks = buildKnowledge(root).references
    expect(blocks).toHaveLength(1)
    expect(blocks[0]!.type).toBe('references')
    expect(blocks[0]!.raw).toContain('| 1 | 某论文 |')
    expect(blocks[0]!.html).toContain('<table>')
    expect(blocks[0]!.html).toContain('href="http://example.com/a"')
    expect(blocks[0]!.raw.includes(':::') || blocks[0]!.html.includes(':::')).toBe(false)
  })

  it('真实的 references.md 逐条可查：表格行与超链接都在（防止将来退化时无人报警）', () => {
    const blocks = buildKnowledge().references
    expect(blocks).toHaveLength(1)
    const block = blocks[0]!
    expect(block.type).toBe('references')
    // 表头 1 行 + 数据行；数据行数量与目录里的条目数一致
    expect(block.html).toContain('<table>')
    expect(block.html.match(/<tr>/g)?.length ?? 0).toBeGreaterThan(30)
    // 每一行都带一个「来源」超链接，不是裸文本
    const anchors = block.html.match(/<a href=/g)?.length ?? 0
    expect(anchors).toBeGreaterThanOrEqual(34)
  })
})

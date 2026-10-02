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

  it('真实的 boundaries.md 解析出两条 boundary 块（防止将来退化时无人报警）', () => {
    const blocks = buildKnowledge().boundaries
    expect(blocks).toHaveLength(2)
    expect(blocks.every(b => b.type === 'boundary')).toBe(true)
    expect(blocks.map(b => b.title)).toEqual(['topic="转专业政策"', 'topic="院校录取分数线预测"'])
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

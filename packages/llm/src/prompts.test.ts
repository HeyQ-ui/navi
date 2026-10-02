import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PROMPT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'prompts')

function prompt(name: 'interpret' | 'chat'): string {
  return readFileSync(join(PROMPT_DIR, `${name}.md`), 'utf8')
}

/**
 * 这组用例钉的不是措辞，是设计文档 §8.1 语气规范表的「适用」列。
 * 语气类约束两个场景共用；「不主动引入未问及的内容」与「不以招募提问的方式
 * 收尾」只约束追问——解读按 §8.2 本就要主动产出三段，套上去会与固定输出
 * 结构打架。少了这组断言，某次改提示词时很容易把两者混着抄。
 */
describe('提示词 · 共通部分（设计文档 §8.1）', () => {
  for (const name of ['interpret', 'chat'] as const) {
    it(`${name}.md 带角色设定与四条共通语气规范`, () => {
      const text = prompt(name)
      expect(text).toContain('测试者')
      expect(text).toContain('和善、耐心、客气')
      expect(text).toContain('不评判')
      expect(text).toContain('结论照实说')
      expect(text).toContain('免责话术')
    })

    it(`${name}.md 带解释推荐理由的规则`, () => {
      const text = prompt(name)
      expect(text).toContain('构成要素')
    })

    it(`${name}.md 禁止解释计算机制与报出算法系数`, () => {
      const text = prompt(name)
      expect(text).toContain('不要解释计算机制')
      expect(text).toContain('不要报出权重')
    })
  }
})

describe('提示词 · 仅追问适用的两条（设计文档 §8.1 适用列）', () => {
  it('chat.md 带「不主动引入未问及的内容」与收尾话术', () => {
    const text = prompt('chat')
    expect(text).toContain('没有问到的内容不要出现')
    expect(text).toContain('都可以问我')
  })

  it('interpret.md 不含这两条', () => {
    const text = prompt('interpret')
    expect(text).not.toContain('没有问到的内容不要出现')
    expect(text).not.toContain('都可以问我')
  })
})

describe('提示词 · 解读的输出结构（设计文档 §8.2）', () => {
  it('三段式且第二段对应「主推荐路径」', () => {
    const text = prompt('interpret')
    expect(text).toContain('你现在的位置')
    expect(text).toContain('为什么推荐这条路径')
    expect(text).toContain('接下来关注什么')
  })
})

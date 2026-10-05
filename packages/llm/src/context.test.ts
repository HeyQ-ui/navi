import { describe, it, expect } from 'vitest'
import type { ModelMessage } from 'ai'
import { buildSystemContent, buildInterpretMessages, buildChatMessages } from './context.js'
import type { DiagnosisResult, KnowledgeBundle } from '@navi/core'

const bundle: KnowledgeBundle = {
  indicators: [{ id: 'academic-interest', name: '学术志趣' }],
  questions: [
    {
      id: 'q1',
      indicator: 'academic-interest',
      text: '导师给你一篇 20 页的英文文献，让你一周后汇报。你的第一反应更接近哪一端？',
      options: ['头疼', '能读但会拖', '按部就班', '有点期待', '很兴奋'],
      weight: 1,
    },
  ],
  archetypes: [],
  paths: [
    {
      id: 'same-discipline-baoyan', title: '本学科保研', category: 'academic',
      span: 'same-discipline', status: 'draft', summary: '保研的核心是用绩点排名换免试资格。',
      weights: [{ indicator: 'academic-interest', weight: 1, ideal: 85 }],
      eligibility: [],
    },
    {
      id: 'civil-service', title: '考公考编 / 选调生', category: 'civil',
      span: 'same-discipline', status: 'draft', summary: '体制内就业的核心是应届生身份。',
      weights: [], eligibility: [],
    },
  ],
  blocks: {
    'same-discipline-baoyan': [
      { type: 'timeline', html: '<p>大三下夏令营</p>', raw: '大三下夏令营' },
      { type: 'myth', title: '排名前 10% 就稳了', html: '<p>绩点只是入场券</p>', raw: '绩点只是入场券' },
    ],
    'civil-service': [],
  },
  common: [
    { type: 'myth', title: '目标真空、盲目跟风', html: '<p>随大流决定考研或考公</p>', raw: '随大流决定考研或考公' },
    { type: 'compare', title: '五条路径差异对比', html: '<table></table>', raw: '| 对比维度 | 本学科保研 |' },
  ],
  boundaries: [{ type: 'free', html: '<p>转专业政策无法可靠回答</p>', raw: '转专业政策无法可靠回答' }],
}

const result: DiagnosisResult = {
  indicators: {
    'academic-interest': { score: 82, known: true, consistency: 0.9, sources: ['q1'] },
    'discipline-identity': { score: 40, known: true, consistency: 0.5, sources: ['q2'] },
  },
  paths: [
    {
      id: 'same-discipline-baoyan', match: 78, confidence: 0.74,
      eligibility: { applicable: true, hardFailures: [], softWarnings: [] },
      contributions: [{ indicator: 'academic-interest', match: 90, weight: 1, contribution: 90 }],
    },
  ],
  archetypes: [{ id: 'steady-scholar', affinity: 0.68 }],
}

const knowledge = {
  bundle,
  result,
  pathId: 'same-discipline-baoyan',
  answers: { q1: 3 },
}

describe('buildSystemContent', () => {
  it('带上各维度分数', () => {
    const content = buildSystemContent(knowledge)
    expect(content).toContain('学术志趣')
    expect(content).toContain('82/100')
  })

  it('画像段的维度数按实际渲染的指标数生成，不写死一个会过期的常数', () => {
    // 夹具的 result.indicators 有 2 项。写死「8 个维度」是 v1.4 删掉 gpa-competitiveness
    // 时漏改的陈旧常量，与 §8.5 的「10 维分数」、§9.4 的「7 维雷达图」都对不上
    expect(buildSystemContent(knowledge)).toContain('学生画像（2 个维度，0–100）')
  })

  it('不再带作答一致性（设计文档 §7.3）', () => {
    expect(buildSystemContent(knowledge)).not.toContain('作答一致性')
    expect(buildSystemContent(knowledge)).not.toContain('0.9')
  })

  it('不再带置信度（设计文档 §7.4）', () => {
    expect(buildSystemContent(knowledge)).not.toContain('置信度')
    expect(buildSystemContent(knowledge)).not.toContain('74')
  })

  it('带上本次题目、选项与学生的选择（设计文档 §8.2）', () => {
    const content = buildSystemContent(knowledge)
    expect(content).toContain('导师给你一篇 20 页的英文文献')
    expect(content).toContain('④ 有点期待')
  })

  it('带着本路径的分项贡献，但不给权重与乘积（§8.2 给构成要素而非公式）', () => {
    const content = buildSystemContent(knowledge)
    expect(content).toContain('本路径（本学科保研）的匹配依据')
    expect(content).toContain('按影响从大到小排列')
    expect(content).toContain('你的位置 82')
    expect(content).toContain('这条路径偏好的位置是 85')
    expect(content).not.toContain('权重')
  })

  it('可适用但没有定义权重时，文案不说成「硬性不适用」（回退成因要对得上）', () => {
    const noWeights = {
      ...knowledge,
      result: { ...result, paths: [{ ...result.paths[0]!, contributions: [] }] },
    }
    const content = buildSystemContent(noWeights)
    expect(content).toContain('没有定义权重')
    expect(content).not.toContain('硬性不适用')
  })

  it('硬性不适用导致分项为空时，文案指向真正的成因', () => {
    const inapplicable = {
      ...knowledge,
      result: {
        ...result,
        paths: [{
          ...result.paths[0]!,
          contributions: [],
          eligibility: { applicable: false, hardFailures: [], softWarnings: [] },
        }],
      },
    }
    expect(buildSystemContent(inapplicable)).toContain('硬性不适用')
  })

  it('带上画像软归属百分比', () => {
    expect(buildSystemContent(knowledge)).toContain('68%')
  })

  it('带上本路径全文，且带块标题、不带容器标记', () => {
    const content = buildSystemContent(knowledge)
    expect(content).toContain('大三下夏令营')
    expect(content).toContain('排名前 10% 就稳了')
    expect(content).not.toContain(':::')
  })

  it('不带其他路径的正文', () => {
    expect(buildSystemContent(knowledge)).not.toContain('体制内时间线')
  })

  it('带上全部路径的 summary（跨路径对比问题靠它）', () => {
    const content = buildSystemContent(knowledge)
    expect(content).toContain('保研的核心是用绩点排名换免试资格')
    expect(content).toContain('体制内就业的核心是应届生身份')
  })

  it('带上诚实边界', () => {
    expect(buildSystemContent(knowledge)).toContain('转专业政策无法可靠回答')
  })

  it('只列出本次题目集里的题：夹带的其他年级题目不进上下文（Review Focus 3）', () => {
    const withStray = {
      ...knowledge,
      answers: { ...knowledge.answers, 'gpa-senior-only': 4 },
    }
    const content = buildSystemContent(withStray)
    expect(content).not.toContain('gpa-senior-only')
  })

  it('答案缺失或越界时显示「未作答」，不抛错（Review Focus 4）', () => {
    const broken = { ...knowledge, answers: { ...knowledge.answers, q1: 99 } }
    expect(() => buildSystemContent(broken)).not.toThrow()
    expect(buildSystemContent(broken)).toContain('未作答')
  })
})

describe('上下文 · 通用知识（设计文档 §8.5 v1.5）', () => {
  it('带上通用知识，且保留块标题（标题是内容）', () => {
    const content = buildSystemContent(knowledge)
    expect(content).toContain('## 通用知识（跨路径共用）')
    expect(content).toContain('目标真空、盲目跟风')
    expect(content).toContain('随大流决定考研或考公')
    expect(content).toContain('五条路径差异对比')
  })

  it('通用知识里不带容器标记', () => {
    expect(buildSystemContent(knowledge)).not.toContain(':::')
  })

  it('没有通用知识时整段不出现，而不是留一个空标题', () => {
    const noCommon = { ...knowledge, bundle: { ...bundle, common: [] } }
    expect(buildSystemContent(noCommon)).not.toContain('## 通用知识')
  })
})

describe('buildInterpretMessages', () => {
  it('第一条是 system，最后一条是 user 指令', () => {
    const messages = buildInterpretMessages({ knowledge, systemPrompt: '你是 Navi。' })
    expect(messages[0]!.role).toBe('system')
    expect(messages.at(-1)!.role).toBe('user')
  })

  it('系统内容里同时含提示词与 <knowledge> 包裹的知识', () => {
    const messages = buildInterpretMessages({ knowledge, systemPrompt: '你是 Navi。' })
    const system = String(messages[0]!.content)
    expect(system).toContain('你是 Navi。')
    expect(system).toContain('<knowledge>')
    expect(system).toContain('</knowledge>')
  })
})

describe('buildChatMessages', () => {
  it('保留传入的对话历史（含本轮提问），前面加一条 system', () => {
    const history: ModelMessage[] = [
      { role: 'user', content: '保研和考研怎么选？' },
      { role: 'assistant', content: '两者时间窗口不同。' },
    ]
    const messages = buildChatMessages({ knowledge, systemPrompt: '你是 Navi。', history })
    expect(messages).toHaveLength(3)
    expect(messages[0]!.role).toBe('system')
    expect(messages[1]!.content).toBe('保研和考研怎么选？')
    expect(messages.at(-1)!.role).toBe('assistant')
  })

  it('历史为空时只剩 system 一条', () => {
    const messages = buildChatMessages({ knowledge, systemPrompt: '你是 Navi。', history: [] })
    expect(messages).toHaveLength(1)
    expect(messages[0]!.role).toBe('system')
  })
})

const priorResult: DiagnosisResult = {
  indicators: {
    'academic-interest': { score: 40, known: true, consistency: 0.8, sources: ['q1'] },
  },
  paths: [{
    id: 'same-discipline-kaoyan', match: 44, confidence: 0.6,
    eligibility: { applicable: true, hardFailures: [], softWarnings: [] },
    contributions: [],
  }],
  archetypes: [],
}

describe('上下文 · 历次自我测评（专项 §11.4）', () => {
  it('有历史时渲染出时间、分数与主推荐路径', () => {
    const text = buildSystemContent({
      ...knowledge,
      history: [{ createdAt: '2026-01-05T00:00:00.000Z', result: priorResult }],
    })
    expect(text).toContain('2026-01-05')
    expect(text).toContain('学术志趣：40/100')
    // 断言路径 id 而不是中文名：id 一定会出现（查不到标题时回落成 id），
    // 而这份 bundle 里没有这条路径
    expect(text).toContain('same-discipline-kaoyan')
  })

  it('有历史时刻意说明「不含本次」，免得模型把当次当成历史', () => {
    const text = buildSystemContent({
      ...knowledge,
      history: [{ createdAt: '2026-01-05T00:00:00.000Z', result: priorResult }],
    })
    expect(text).toContain('不含本次')
  })

  it('没有历史时整段不出现，而不是留一个空标题', () => {
    expect(buildSystemContent({ ...knowledge })).not.toContain('历次自我测评')
    expect(buildSystemContent({ ...knowledge, history: [] })).not.toContain('历次自我测评')
  })
})

describe('上下文 · 此前的对话（专项 §11.4）', () => {
  it('按角色渲染成对话记录', () => {
    const text = buildSystemContent({
      ...knowledge,
      conversation: [
        { role: 'user', content: '保研和考研怎么选？' },
        { role: 'assistant', content: '两者的时间窗不同。' },
      ],
    })
    expect(text).toContain('保研和考研怎么选？')
    expect(text).toContain('两者的时间窗不同。')
  })

  it('没有对话时整段不出现', () => {
    expect(buildSystemContent({ ...knowledge })).not.toContain('此前的对话')
    expect(buildSystemContent({ ...knowledge, conversation: [] })).not.toContain('此前的对话')
  })
})

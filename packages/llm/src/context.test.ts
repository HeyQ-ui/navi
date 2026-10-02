import { describe, it, expect } from 'vitest'
import type { ModelMessage } from 'ai'
import { buildSystemContent, buildInterpretMessages, buildChatMessages } from './context.js'
import type { DiagnosisResult, KnowledgeBundle } from '@navi/core'

const bundle: KnowledgeBundle = {
  indicators: [{ id: 'academic-interest', name: '学术志趣' }],
  questions: [],
  archetypes: [],
  paths: [
    {
      id: 'same-discipline-baoyan', title: '本学科保研', category: 'academic',
      span: 'same-discipline', status: 'draft', summary: '保研的核心是用绩点排名换免试资格。',
      weights: [], eligibility: [],
    },
    {
      id: 'civil-service', title: '考公考编 / 选调生', category: 'civil',
      span: 'same-discipline', status: 'draft', summary: '体制内就业的核心是应届生身份。',
      weights: [], eligibility: [],
    },
  ],
  blocks: {
    'same-discipline-baoyan': [{ type: 'timeline', html: '<p>大三下夏令营</p>', raw: '大三下夏令营' }],
    'civil-service': [],
  },
  boundaries: [{ type: 'free', html: '<p>转专业政策无法可靠回答</p>', raw: '转专业政策无法可靠回答' }],
}

const result: DiagnosisResult = {
  indicators: {
    'academic-interest': { score: 82, known: true, consistency: 0.9, sources: ['q1'] },
    'gpa-competitiveness': { score: 40, known: true, consistency: 0.5, sources: ['q2'] },
  },
  paths: [
    {
      id: 'same-discipline-baoyan', match: 78, confidence: 0.74,
      eligibility: { applicable: true, hardFailures: [], softWarnings: [] },
      contributions: [],
    },
  ],
  archetypes: [{ id: 'steady-scholar', affinity: 0.68 }],
}

const knowledge = { bundle, result, pathId: 'same-discipline-baoyan' }

describe('buildSystemContent', () => {
  it('带上全部 8 维分数与一致性', () => {
    const content = buildSystemContent(knowledge)
    expect(content).toContain('学术志趣')
    expect(content).toContain('82')
    expect(content).toContain('0.9')
  })

  it('带上画像软归属百分比', () => {
    expect(buildSystemContent(knowledge)).toContain('68%')
  })

  it('带上本路径全文，且只有本路径的正文', () => {
    const content = buildSystemContent(knowledge)
    expect(content).toContain('大三下夏令营')
  })

  it('带上全部路径的 summary（跨路径对比问题靠它）', () => {
    const content = buildSystemContent(knowledge)
    expect(content).toContain('保研的核心是用绩点排名换免试资格')
    expect(content).toContain('体制内就业的核心是应届生身份')
  })

  it('带上诚实边界', () => {
    expect(buildSystemContent(knowledge)).toContain('转专业政策无法可靠回答')
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

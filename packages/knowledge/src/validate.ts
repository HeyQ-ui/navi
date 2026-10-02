import type { Block } from './parse.js'

export type { Block }

export interface IndicatorDef {
  id: string
  name: string
}

export interface QuestionDef {
  id: string
  indicator: string
  text: string
  options: string[]
  weight: number
  grades?: string[]
}

export interface ArchetypeDef {
  id: string
  name: string
  vector: Record<string, number>
  narrative: {
    oneLiner: string
    strengths: string[]
    blindspots: string[]
  }
}

export interface PathWeight {
  indicator: string
  weight: number
  ideal: number
}

export interface EligibilityCondition {
  id: string
  questionId: string
  severity: 'hard' | 'soft'
  failMessage: string
  passWhen: number[]
}

export interface PathDef {
  id: string
  title: string
  category: string
  span: string
  status: 'draft' | 'review' | 'verified'
  weights: PathWeight[]
  eligibility: EligibilityCondition[]
  summary: string
}

export interface KnowledgeBundle {
  indicators: IndicatorDef[]
  questions: QuestionDef[]
  archetypes: ArchetypeDef[]
  paths: PathDef[]
  blocks: Record<string, Block[]>
  /** 诚实边界清单（设计文档 §8.4）。文件缺失时为空数组 */
  boundaries: Block[]
}

const MIN_QUESTIONS_PER_INDICATOR = 3

export function validateKnowledge(bundle: KnowledgeBundle): string[] {
  const warnings: string[] = []

  const indicatorIds = new Set(bundle.indicators.map(i => i.id))

  for (const indicator of bundle.indicators) {
    const count = bundle.questions.filter(q => q.indicator === indicator.id).length
    if (count < MIN_QUESTIONS_PER_INDICATOR) {
      warnings.push(
        `指标 ${indicator.id} 仅有 ${count} 道题，少于要求的 ${MIN_QUESTIONS_PER_INDICATOR} 道（设计文档 §7.1）`,
      )
    }
  }

  for (const question of bundle.questions) {
    if (!indicatorIds.has(question.indicator)) {
      warnings.push(`题目 ${question.id} 引用了不存在的指标 ${question.indicator}`)
    }
    if (question.options.length !== 5) {
      warnings.push(`题目 ${question.id} 有 ${question.options.length} 个选项，应为 5 个（设计文档 §5.2）`)
    }
  }

  const seen = new Set<string>()
  for (const path of bundle.paths) {
    if (seen.has(path.id)) warnings.push(`路径 id 重复：${path.id}`)
    seen.add(path.id)

    for (const w of path.weights) {
      if (!indicatorIds.has(w.indicator)) {
        warnings.push(`路径 ${path.id} 的权重引用了不存在的指标 ${w.indicator}`)
      }
    }

    if (!bundle.blocks[path.id]) {
      warnings.push(`路径 ${path.id} 尚未撰写任何内容块`)
    }
  }

  for (const docId of Object.keys(bundle.blocks)) {
    if (!seen.has(docId)) {
      warnings.push(`存在没有对应路径定义的文档目录：${docId}`)
    }
  }

  return warnings
}

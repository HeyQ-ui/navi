import type { Block } from './parse.js'

export type { Block }

export interface IndicatorDef {
  id: string
  name: string
}

export interface QuestionDef {
  id: string
  /** 单指标题：各选项按五档位置映射到该指标。带 scores 的多指标题不写这个字段 */
  indicator?: string
  text: string
  options: string[]
  weight: number
  grades?: string[]
  /** 每选项对若干指标的分值；某选项没写某指标 = 这道题对该指标没有信息 */
  scores?: Record<string, number>[]
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
  /** 通用知识（设计文档 §6.1）。文件缺失时为空数组 */
  common: Block[]
  /** 诚实边界清单（设计文档 §8.4）。文件缺失时为空数组 */
  boundaries: Block[]
}

const MIN_QUESTIONS_PER_INDICATOR = 3

export function validateKnowledge(bundle: KnowledgeBundle): string[] {
  const warnings: string[] = []

  const indicatorIds = new Set(bundle.indicators.map(i => i.id))

  for (const indicator of bundle.indicators) {
    // 多指标题（带 scores）由一道题同时供给多个指标，「至少 3 道」对这类指标不适用：
    // 一道题既要当保研意愿又要当考研意愿，按 3 道题要求它就成了不可能满足的条件
    const suppliedByMulti = bundle.questions.some(
      q => q.scores?.some(optionScores => optionScores[indicator.id] !== undefined) === true,
    )
    if (suppliedByMulti) continue

    const count = bundle.questions.filter(q => q.indicator === indicator.id).length
    if (count < MIN_QUESTIONS_PER_INDICATOR) {
      warnings.push(
        `指标 ${indicator.id} 仅有 ${count} 道题，少于要求的 ${MIN_QUESTIONS_PER_INDICATOR} 道（设计文档 §7.1）`,
      )
    }
  }

  for (const question of bundle.questions) {
    if (question.scores === undefined) {
      if (question.indicator === undefined) {
        warnings.push(`题目 ${question.id} 既没有 indicator 也没有 scores`)
      } else if (!indicatorIds.has(question.indicator)) {
        warnings.push(`题目 ${question.id} 引用了不存在的指标 ${question.indicator}`)
      }
      // 选项数只在走五档位置映射时才必须是 5：显式给了 scores 的题选项数由它自己定，
      // 不计分的资格题（weight 0）也不走这套映射——它的选项是「有/没有/不清楚」这类
      // 名义取值，本来就不该凑够五档
      if (question.weight > 0 && question.options.length !== 5) {
        warnings.push(`题目 ${question.id} 有 ${question.options.length} 个选项，应为 5 个（设计文档 §5.2）`)
      }
      continue
    }

    if (question.scores.length !== question.options.length) {
      warnings.push(
        `题目 ${question.id} 的 scores 有 ${question.scores.length} 项，与 ${question.options.length} 个选项不一致`,
      )
    }
    for (const optionScores of question.scores) {
      for (const id of Object.keys(optionScores)) {
        if (!indicatorIds.has(id)) {
          warnings.push(`题目 ${question.id} 的 scores 引用了不存在的指标 ${id}`)
        }
      }
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

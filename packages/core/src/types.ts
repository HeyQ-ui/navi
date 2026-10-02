export type IndicatorId =
  | 'academic-interest'
  | 'gpa-competitiveness'
  | 'discipline-identity'
  | 'cost-tolerance'
  | 'risk-preference'
  | 'stress-endurance'
  | 'public-affairs-leaning'
  | 'accumulation-drive'

export type PathId = string

export interface IndicatorScore {
  /** 0–100 */
  score: number
  /** 该指标是否有足够信息计算。全必答问卷下正常为 true */
  known: boolean
  /** 0–1，作答一致性（设计文档 §7.3） */
  consistency: number
  /** 参与计算的题目 id */
  sources: string[]
}

export interface Contribution {
  indicator: IndicatorId
  /** 该指标与理想值的接近程度，0–100 */
  match: number
  /** 重归一化后的权重 */
  weight: number
  /** match × weight */
  contribution: number
}

export interface EligibilityFailure {
  id: string
  severity: 'hard' | 'soft'
  message: string
}

export interface PathResult {
  id: PathId
  /** 0–100 */
  match: number
  /** 0–1，置信度（设计文档 §7.4） */
  confidence: number
  eligibility: {
    applicable: boolean
    hardFailures: EligibilityFailure[]
    softWarnings: EligibilityFailure[]
  }
  contributions: Contribution[]
}

export interface ArchetypeResult {
  id: string
  /** 0–1，软归属比例（设计文档 §7.7） */
  affinity: number
}

export interface DiagnosisResult {
  indicators: Record<string, IndicatorScore>
  paths: PathResult[]
  archetypes: ArchetypeResult[]
}

export interface Question {
  id: string
  indicator: IndicatorId
  text: string
  options: string[]
  weight: number
  grades?: string[]
}

export interface IndicatorDef {
  id: IndicatorId
  name: string
}

export interface PathWeight {
  indicator: IndicatorId
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
  id: PathId
  title: string
  category: string
  span: string
  status: 'draft' | 'review' | 'verified'
  weights: PathWeight[]
  eligibility: EligibilityCondition[]
  summary: string
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

export interface Block {
  type: string
  /** `:::myth 标题` 写法里 `:::` 之后的那段。没有则为 undefined（§6.3 不强制字段） */
  title?: string
  html: string
  raw: string
}

export interface KnowledgeBundle {
  indicators: IndicatorDef[]
  questions: Question[]
  archetypes: ArchetypeDef[]
  paths: PathDef[]
  blocks: Record<string, Block[]>
  /** 诚实边界清单（设计文档 §8.4）。文件缺失时为空数组 */
  boundaries: Block[]
}

/** 问卷答案：题目 id → 选项索引（0–4） */
export type Answers = Record<string, number>

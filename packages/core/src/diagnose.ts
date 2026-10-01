import type { Answers, DiagnosisResult, KnowledgeBundle, PathResult } from './types.js'
import { computeIndicatorScores } from './scoring.js'
import { evaluateEligibility } from './eligibility.js'
import { computePathMatch } from './matching.js'
import { computeArchetypeAffinity } from './archetype.js'

export interface DiagnoseOptions {
  /** 画像聚类温度，默认 0.1 */
  temperature?: number
  /** 接近判定的分数阈值，默认 5 */
  closeMatchThreshold?: number
}

const DEFAULT_CLOSE_THRESHOLD = 5

/**
 * 诊断编排入口（设计文档 §4）。
 * 纯函数：同样输入必然得到同样输出，不依赖网络与时钟。
 * 不适用路径的 match 记为 0，但仍保留在结果中并附失败原因。
 */
export function diagnose(
  answers: Answers,
  knowledge: KnowledgeBundle,
  options: DiagnoseOptions = {},
): DiagnosisResult {
  const indicators = computeIndicatorScores(answers, knowledge.questions, knowledge.indicators)

  const paths: PathResult[] = knowledge.paths.map(path => {
    const { match, confidence, contributions } = computePathMatch(indicators, path.weights)
    const eligibility = evaluateEligibility(path.eligibility, answers)

    return {
      id: path.id,
      match: eligibility.applicable ? match : 0,
      confidence,
      eligibility,
      contributions,
    }
  })

  paths.sort((a, b) => b.match - a.match)

  const archetypes = computeArchetypeAffinity(
    indicators,
    knowledge.archetypes,
    options.temperature,
  )

  return { indicators, paths, archetypes }
}

/**
 * 找出与最高分差距在阈值内的路径（设计文档 §10「多条路径分数接近」）。
 * 优先在适用路径中比较；若全部不适用，则在整个结果中比较。
 */
export function findCloseMatches(
  result: DiagnosisResult,
  threshold: number = DEFAULT_CLOSE_THRESHOLD,
): PathResult[] {
  const applicable = result.paths.filter(p => p.eligibility.applicable)
  const pool = applicable.length > 0 ? applicable : result.paths
  if (pool.length === 0) return []

  const top = pool[0]!.match
  return pool.filter(p => top - p.match <= threshold)
}

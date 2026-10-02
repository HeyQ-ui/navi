import type { Answers, DiagnosisResult, KnowledgeBundle, PathResult } from './types.js'
import { computeIndicatorScores } from './scoring.js'
import { evaluateEligibility } from './eligibility.js'
import { computePathMatch } from './matching.js'
import { computeArchetypeAffinity } from './archetype.js'

export interface DiagnoseOptions {
  /** 画像聚类温度，默认 0.1 */
  temperature?: number
}

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
      // hard 约束失败时这条路径不参与打分：match 与分项贡献一并归零，
      // 否则 contributions 之和与展示的 match 不自洽
      match: eligibility.applicable ? match : 0,
      confidence,
      eligibility,
      contributions: eligibility.applicable ? contributions : [],
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
 * 找出与最高显示分并列的适用路径（设计文档 §9.3）。
 *
 * 判据是 Math.round(match)：match 是加权平均和，精确相等在实际数据里几乎不可能
 * 出现，按浮点比较会让这条提示永不触发。取整后比较，用户屏幕上看到的分数一样，
 * 提示就出现。
 *
 * 返回的数组含最高分那条自身（调用方按 length > 1 判断是否需要展示并列）。
 * 只用可适用路径参与判定：硬性不适用的路径没有匹配度可言，把它算进并列是误导。
 * 同理，一条可适用的都没有时返回空数组——此时没有主推荐路径，也无从谈并列。
 *
 * 不依赖 paths 已排序：显式取最大值，避免调用方换了顺序就悄悄出错。
 */
export function findTiedPaths(result: DiagnosisResult): PathResult[] {
  const applicable = result.paths.filter(p => p.eligibility.applicable)
  if (applicable.length === 0) return []

  const top = Math.max(...applicable.map(p => Math.round(p.match)))
  return applicable.filter(p => Math.round(p.match) === top)
}

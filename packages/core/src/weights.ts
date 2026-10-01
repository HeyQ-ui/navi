import type { IndicatorScore, PathWeight } from './types.js'

export interface NormalizedWeights {
  /** 仅包含已知指标的权重，总和为 1（若存在已知指标） */
  entries: PathWeight[]
}

/**
 * 权重重归一化（设计文档 §7.2）。
 * 全必答问卷下该机制通常不改变权重；它作为鲁棒性保障存在。
 */
export function normalizeWeights(
  weights: PathWeight[],
  scores: Record<string, IndicatorScore>,
): NormalizedWeights {
  const known = weights.filter(w => scores[w.indicator]?.known === true)
  const total = known.reduce((s, w) => s + w.weight, 0)

  if (known.length === 0 || total <= 0) {
    return { entries: [] }
  }

  return { entries: known.map(w => ({ ...w, weight: w.weight / total })) }
}

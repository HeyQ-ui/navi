import type { IndicatorScore, PathWeight } from './types.js'

export interface NormalizedWeights {
  /** 仅包含已知指标的权重，总和为 1（若存在已知指标） */
  entries: PathWeight[]
  /** 原始权重中已知部分所占比例，0–1 */
  coverage: number
}

/**
 * 权重重归一化（设计文档 §7.2）。
 * 全必答问卷下 coverage 通常为 1；该机制作为鲁棒性保障存在。
 */
export function normalizeWeights(
  weights: PathWeight[],
  scores: Record<string, IndicatorScore>,
): NormalizedWeights {
  const known = weights.filter(w => scores[w.indicator]?.known === true)
  const total = known.reduce((s, w) => s + w.weight, 0)

  if (known.length === 0 || total <= 0) {
    return { entries: [], coverage: 0 }
  }

  return {
    entries: known.map(w => ({ ...w, weight: w.weight / total })),
    coverage: total,
  }
}

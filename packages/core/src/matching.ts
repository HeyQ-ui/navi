import type { Contribution, IndicatorScore, PathWeight } from './types.js'
import { normalizeWeights } from './weights.js'

export interface PathMatchResult {
  match: number
  confidence: number
  contributions: Contribution[]
}

/** 指标与理想值的接近程度，0–100（设计文档 §7.6） */
export function indicatorMatch(score: number, ideal: number): number {
  return Math.max(0, 100 - Math.abs(score - ideal))
}

export function computePathMatch(
  scores: Record<string, IndicatorScore>,
  weights: PathWeight[],
): PathMatchResult {
  const { entries } = normalizeWeights(weights, scores)

  if (entries.length === 0) {
    return { match: 0, confidence: 0, contributions: [] }
  }

  const contributions: Contribution[] = entries.map(entry => {
    const score = scores[entry.indicator]!
    const match = indicatorMatch(score.score, entry.ideal)
    return {
      indicator: entry.indicator,
      match,
      weight: entry.weight,
      contribution: match * entry.weight,
    }
  })

  const match = contributions.reduce((acc, c) => acc + c.contribution, 0)
  const confidence = contributions.reduce(
    (acc, c) => acc + c.weight * (scores[c.indicator]?.consistency ?? 0),
    0,
  )

  return { match, confidence, contributions }
}

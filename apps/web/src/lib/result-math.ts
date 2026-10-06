import type { DiagnosisResult, PathResult, PathWeight } from '@navi/core'

/**
 * 入雷达图的 7 个画像类指标（主文档 §9.2）。
 * 3 个意愿类指标（grad-intention-*）刻画的是「想不想」而非「像不像」，不入图。
 */
export const PROFILE_INDICATORS = [
  'academic-interest',
  'accumulation-drive',
  'discipline-identity',
  'cost-tolerance',
  'public-affairs-leaning',
  'risk-preference',
  'stress-endurance',
] as const

export interface RadarRow {
  id: string
  name: string
  score: number
  ideal?: number
}

export function radarRows(
  result: DiagnosisResult,
  indicators: Array<{ id: string; name: string }>,
  idealOf?: (indicatorId: string) => number | undefined,
): RadarRow[] {
  const names = new Map(indicators.map(i => [i.id, i.name]))
  return PROFILE_INDICATORS
    .filter(id => result.indicators[id]?.known === true)
    .map(id => {
      const row: RadarRow = { id, name: names.get(id) ?? id, score: result.indicators[id]!.score }
      const ideal = idealOf?.(id)
      if (ideal !== undefined) row.ideal = ideal
      return row
    })
}

export interface GapRow {
  id: string
  name: string
  score: number
  ideal: number
  gap: number
}

/** 差距榜：主推荐路径权重里差距最大的 3 个维度（前端重设计 spec §5.5 03 段） */
export function gapRows(
  result: DiagnosisResult,
  indicators: Array<{ id: string; name: string }>,
  weights: PathWeight[],
): GapRow[] {
  const names = new Map(indicators.map(i => [i.id, i.name]))
  return weights
    .map((w): GapRow | null => {
      const s = result.indicators[w.indicator]
      if (s === undefined || !s.known) return null
      return {
        id: w.indicator,
        name: names.get(w.indicator) ?? w.indicator,
        score: s.score,
        ideal: w.ideal,
        gap: Math.abs(s.score - w.ideal),
      }
    })
    .filter((r): r is GapRow => r !== null)
    .sort((a, b) => b.gap - a.gap)
    .slice(0, 3)
}

/** 主推荐 = 按匹配度降序的第一条可适用路径（core 的 diagnose 保证降序） */
export function mainPathOf(result: DiagnosisResult): PathResult | null {
  return result.paths.find(p => p.eligibility.applicable) ?? null
}

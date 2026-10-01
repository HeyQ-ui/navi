import type { ArchetypeDef, ArchetypeResult, IndicatorScore } from './types.js'

/** 默认温度：越小分布越尖锐（设计文档 §7.7） */
export const DEFAULT_TEMPERATURE = 0.1

export function cosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length)
  if (len === 0) return 0

  let dot = 0
  let normA = 0
  let normB = 0

  for (let i = 0; i < len; i++) {
    dot += a[i]! * b[i]!
    normA += a[i]! * a[i]!
    normB += b[i]! * b[i]!
  }

  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

/**
 * 画像软归属（设计文档 §7.7）。
 * 仅在与原型共同已知的维度上计算余弦相似度，缺失维度不参与。
 * 无任何共同维度时相似度一律取 0，经 softmax 后各原型均分。
 */
export function computeArchetypeAffinity(
  scores: Record<string, IndicatorScore>,
  archetypes: ArchetypeDef[],
  temperature: number = DEFAULT_TEMPERATURE,
): ArchetypeResult[] {
  if (archetypes.length === 0) return []

  const similarities = archetypes.map(archetype => {
    const dims = Object.keys(archetype.vector).filter(id => scores[id]?.known === true)
    if (dims.length === 0) return 0
    return cosineSimilarity(
      dims.map(id => scores[id]!.score),
      dims.map(id => archetype.vector[id]!),
    )
  })

  const safeTemp = temperature > 0 ? temperature : DEFAULT_TEMPERATURE
  const maxSim = Math.max(...similarities)
  const exps = similarities.map(sim => Math.exp((sim - maxSim) / safeTemp))
  const total = exps.reduce((a, b) => a + b, 0)

  return archetypes
    .map((archetype, i) => ({
      id: archetype.id,
      affinity: total > 0 ? exps[i]! / total : 1 / archetypes.length,
    }))
    .sort((a, b) => b.affinity - a.affinity)
}

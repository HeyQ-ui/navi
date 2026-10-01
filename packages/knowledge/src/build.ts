import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parse as parseYaml } from 'yaml'
import { parseFrontmatter, parseBlocks } from './parse.js'
import { validateKnowledge } from './validate.js'
import type {
  KnowledgeBundle, IndicatorDef, QuestionDef, ArchetypeDef, PathDef, Block,
} from './validate.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

function readYamlDir<T>(dir: string): T[] {
  const full = join(ROOT, dir)
  if (!existsSync(full)) return []
  return readdirSync(full)
    .filter(f => f.endsWith('.yaml') || f.endsWith('.yml'))
    .map(f => parseYaml(readFileSync(join(full, f), 'utf8')) as T)
}

export function buildKnowledge(rootDir = ROOT): KnowledgeBundle {
  const indicators = readYamlDir<IndicatorDef>('indicators')
  const questions = readYamlDir<QuestionDef>('questions')
  const archetypes = readYamlDir<ArchetypeDef>('archetypes')

  const pathsDir = join(rootDir, 'paths')
  const paths: PathDef[] = []
  const blocks: Record<string, Block[]> = {}

  if (existsSync(pathsDir)) {
    for (const entry of readdirSync(pathsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const docPath = join(pathsDir, entry.name, 'index.md')
      if (!existsSync(docPath)) continue

      const { data, content } = parseFrontmatter(readFileSync(docPath, 'utf8'))
      const id = String(data.id ?? entry.name)
      paths.push({
        id,
        title: String(data.title ?? entry.name),
        category: String(data.category ?? ''),
        span: String(data.span ?? ''),
        status: (data.status as PathDef['status']) ?? 'draft',
        summary: String(data.summary ?? '').trim(),
        weights: (data.weights as PathDef['weights']) ?? [],
        eligibility: (data.eligibility as PathDef['eligibility']) ?? [],
      })
      blocks[id] = parseBlocks(content)
    }
  }

  return { indicators, questions, archetypes, paths, blocks }
}

function main(): void {
  const bundle = buildKnowledge()
  const warnings = validateKnowledge(bundle)

  for (const warning of warnings) {
    console.warn(`[knowledge] 警告：${warning}`)
  }

  const outDir = join(ROOT, 'dist')
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, 'knowledge.json'), JSON.stringify(bundle, null, 2), 'utf8')

  console.log(
    `[knowledge] 已编译 ${bundle.paths.length} 条路径、${bundle.indicators.length} 个指标、` +
    `${bundle.questions.length} 道题目，${warnings.length} 条警告`,
  )
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main()
}

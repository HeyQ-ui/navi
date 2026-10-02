import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parse as parseYaml } from 'yaml'
import { parseFrontmatter, parseBlocks, parseContainers } from './parse.js'
import { validateKnowledge } from './validate.js'
import type {
  KnowledgeBundle, IndicatorDef, QuestionDef, ArchetypeDef, PathDef, Block,
} from './validate.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** 读取一个 YAML 目录。按文件名排序，使产物顺序不依赖文件系统的枚举顺序 */
function readYamlDir<T>(rootDir: string, dir: string): T[] {
  const full = join(rootDir, dir)
  if (!existsSync(full)) return []
  return readdirSync(full)
    .filter(f => f.endsWith('.yaml') || f.endsWith('.yml'))
    .sort()
    .map(f => parseYaml(readFileSync(join(full, f), 'utf8')) as T)
}

export function buildKnowledge(rootDir = ROOT): KnowledgeBundle {
  const indicators = readYamlDir<IndicatorDef>(rootDir, 'indicators')
  const questions = readYamlDir<QuestionDef>(rootDir, 'questions')
  const archetypes = readYamlDir<ArchetypeDef>(rootDir, 'archetypes')

  const pathsDir = join(rootDir, 'paths')
  const paths: PathDef[] = []
  const blocks: Record<string, Block[]> = {}

  if (existsSync(pathsDir)) {
    const dirNames = readdirSync(pathsDir, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
      .sort()

    for (const name of dirNames) {
      const docPath = join(pathsDir, name, 'index.md')
      if (!existsSync(docPath)) continue

      const { data, content } = parseFrontmatter(readFileSync(docPath, 'utf8'))
      const id = String(data.id ?? name)
      paths.push({
        id,
        title: String(data.title ?? name),
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

  // 按 id 排序，使顺序与目录命名无关。「同样输入必然同样输出」依赖于此
  paths.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

  // 诚实边界清单（设计文档 §8.4）。整个文件是 `:::boundary` 容器序列，
  // 走 parseContainers 而非 parseBlocks，每条边界各成一块且不带字面 `:::`
  const boundariesPath = join(rootDir, 'boundaries.md')
  const boundaries = existsSync(boundariesPath)
    ? parseContainers(parseFrontmatter(readFileSync(boundariesPath, 'utf8')).content)
    : []

  return { indicators, questions, archetypes, paths, blocks, boundaries }
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

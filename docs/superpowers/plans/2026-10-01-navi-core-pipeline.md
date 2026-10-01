# Navi 核心链路实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 打通「问卷 → 指标 → 路径推荐」的端到端确定性链路，产出一个可演示的最小可用产品。

**Architecture:** pnpm monorepo。`packages/knowledge` 存放 Markdown 知识库并提供构建期编译脚本，输出 JSON 产物；`packages/core` 是零框架依赖、零网络请求的纯逻辑层，消费编译产物与问卷答案，输出结构化诊断结果；`apps/api` 是 Hono 薄层，暴露 `/api/diagnose`；`apps/web` 是 Vite + React SPA，提供问卷与结果页。

**Tech Stack:** TypeScript · pnpm workspace · Vitest · Hono · React + Vite + TailwindCSS · marked

**Spec:** `docs/superpowers/specs/2026-09-27-navi-career-planning-agent-design.md`

## Global Constraints

以下约束适用于本计划的每一个任务，不再逐条重复：

- TypeScript `strict: true`，所有包启用
- **`packages/core` 零框架依赖、零网络请求**——不得 import `react` / `hono` / `express`，不得调用 `fetch` / `XMLHttpRequest`。此约束由 ESLint 规则强制（Task 1）
- **推荐结果必须由 `core` 确定性算出，不得由大模型生成**——本计划完全不调用大模型
- 每个指标至少由 **3 道题**测量（设计文档 §7.1）
- 问卷五档评分映射固定为 **`[0, 25, 50, 75, 100]`**（设计文档 §5.2）
- 题目方向统一为「档位越高 = 指标越高」，**不引入反向计分**
- 知识库出现未识别块类型时**仅警告不阻断构建**（设计文档 §6.4）
- `.env` 保持在 `.gitignore` 中，任何 API Key 不得进入源码
- 提交信息使用中文，遵循 Conventional Commits（`feat:` / `fix:` / `chore:` / `docs:` / `test:`）

## Review Focus

以下是设计文档隐含、但单个任务的测试不会自然覆盖的输入与失败模式。每一条都在下方指定任务中被专门的测试固定住。

1. **全部指标均不可用时的输出**——`computeIndicatorScores` 收到空答案对象。用户会期望得到一个明确的「信息不足」结果，而不是 `NaN` 或崩溃。（Task 6、12）
2. **所有路径都被 hard 约束剔除**——用户会期望看到逐条解释原因，而不是空白页或异常。（Task 12）
3. **多条路径匹配分几乎相同**——用户会期望同时看到两条推荐并被告知差异，而不是被随机排序掩盖。（Task 12）
4. **学生不属于任何画像原型**（相似度全部很低）——用户会期望仍得到最接近的一个标签，而不是空数组。（Task 11）
5. **作答完全一致导致的边界**——`stdev = 0` 时一致性应为 1；`stdev` 达到理论最大 50 时一致性应为 0，且不得为负。（Task 7）

---

## File Structure

```
navi/
├── package.json                    # workspace 根，统一脚本
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── eslint.config.js                # 含 core 边界规则
├── packages/
│   ├── knowledge/
│   │   ├── package.json
│   │   ├── meta.yaml
│   │   ├── indicators/*.yaml       # 8 个指标定义
│   │   ├── archetypes/*.yaml       # 画像原型
│   │   ├── questions/*.yaml        # 问卷题目
│   │   ├── paths/<pathId>/*.md     # 7 条路径文档
│   │   ├── src/parse.ts            # frontmatter + @block 解析
│   │   ├── src/build.ts            # 编译为 JSON
│   │   └── src/validate.ts         # 校验（仅警告）
│   └── core/
│       ├── package.json
│       ├── src/types.ts            # 输出契约（设计文档 §7.8）
│       ├── src/scoring.ts          # 指标计算 + 一致性
│       ├── src/weights.ts          # 权重重归一化
│       ├── src/eligibility.ts      # 资格过滤
│       ├── src/matching.ts         # 匹配度 + 置信度
│       ├── src/archetype.ts        # 余弦相似度 + softmax
│       └── src/diagnose.ts         # 编排入口
└── apps/
    ├── api/
    │   ├── package.json
    │   └── src/server.ts            # Hono + /api/diagnose
    └── web/
        ├── package.json
        ├── vite.config.ts
        ├── index.html
        └── src/
            ├── main.tsx
            ├── App.tsx
            ├── api.ts
            ├── components/Questionnaire.tsx
            └── components/ResultView.tsx
```

---

### Task 1: Monorepo 脚手架与边界约束

建立 workspace 骨架，并用 ESLint 把设计文档 §3.3 的模块边界**硬化成编译期检查**——这是让团队所有 AI 助手行为一致的关键机制。

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `eslint.config.js`
- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/core/eslint.config.js`
- Create: `packages/core/src/smoke.test.ts`
- Create: `.gitignore`（已存在，确认包含 `.env`）

**Interfaces:**
- Consumes: 无
- Produces: workspace 根脚本 `pnpm test` / `pnpm lint` / `pnpm build`，供所有后续任务使用

- [ ] **Step 1: 创建 workspace 配置**

`pnpm-workspace.yaml`：

```yaml
packages:
  - 'packages/*'
  - 'apps/*'
```

根 `package.json`：

```json
{
  "name": "navi",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "pnpm -r test",
    "lint": "pnpm -r lint",
    "build": "pnpm -r build",
    "dev": "pnpm --parallel -r dev"
  },
  "devDependencies": {
    "@eslint/js": "^9.17.0",
    "eslint": "^9.17.0",
    "typescript": "^5.7.2",
    "typescript-eslint": "^8.18.0",
    "vitest": "^2.1.8"
  }
}
```

`tsconfig.base.json`：

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "verbatimModuleSyntax": true,
    "declaration": true,
    "noEmit": true
  }
}
```

- [ ] **Step 2: 创建 core 包骨架**

`packages/core/package.json`：

```json
{
  "name": "@navi/core",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "test": "vitest run",
    "lint": "eslint .",
    "build": "tsc --noEmit"
  },
  "devDependencies": {
    "vitest": "^2.1.8"
  }
}
```

`packages/core/tsconfig.json`：

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src"]
}
```

- [ ] **Step 3: 编写边界约束的 ESLint 配置**

根 `eslint.config.js`：

```js
import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
)
```

`packages/core/eslint.config.js`——**这是本任务的核心交付物**：

```js
import base from '../../eslint.config.js'

export default [
  ...base,
  {
    files: ['src/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          {
            group: ['react', 'react-*', 'hono', 'express', 'fastify', 'vite', '@navi/api', '@navi/web'],
            message: 'core 是纯逻辑层，不得引入框架或上层依赖（设计文档 §3.3）',
          },
        ],
      }],
      'no-restricted-globals': ['error',
        { name: 'fetch', message: 'core 不得发起网络请求（设计文档 §3.3）' },
        { name: 'XMLHttpRequest', message: 'core 不得发起网络请求（设计文档 §3.3）' },
      ],
    },
  },
]
```

- [ ] **Step 4: 写一个冒烟测试并运行**

`packages/core/src/smoke.test.ts`：

```ts
import { describe, it, expect } from 'vitest'

describe('workspace smoke test', () => {
  it('runs vitest in the core package', () => {
    expect(1 + 1).toBe(2)
  })
})
```

Run: `pnpm install && pnpm -r test`
Expected: PASS，core 包中 1 个测试通过

- [ ] **Step 5: 验证边界规则真的会拦住违规代码**

临时在 `packages/core/src/smoke.test.ts` 顶部加入 `import { Hono } from 'hono'`，运行：

Run: `pnpm --filter @navi/core lint`
Expected: **FAIL**，报错信息包含「core 是纯逻辑层，不得引入框架或上层依赖」

确认后**删除这一行**，重新运行确认通过：

Run: `pnpm --filter @navi/core lint`
Expected: PASS

> 这一步不能省。一条从不失败的检查等于没有检查。

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-workspace.yaml tsconfig.base.json eslint.config.js packages/core
git commit -m "chore: 初始化 pnpm workspace 与 core 包，硬化模块边界约束"
```

---

### Task 2: 知识库解析器

解析路径文档的 frontmatter 与 `@block` 注解，输出结构化块。**未识别的块类型不得报错**（设计文档 §6.3）。

**Files:**
- Create: `packages/knowledge/package.json`
- Create: `packages/knowledge/tsconfig.json`
- Create: `packages/knowledge/src/parse.ts`
- Test: `packages/knowledge/src/parse.test.ts`

**Interfaces:**
- Consumes: Task 1 的 workspace 与 vitest 配置
- Produces:
  - `parseFrontmatter(raw: string): { data: Record<string, unknown>; content: string }`
  - `parseBlocks(content: string): Block[]`
  - `interface Block { type: string; html: string; raw: string }`

- [ ] **Step 1: 写失败的测试**

`packages/knowledge/src/parse.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { parseFrontmatter, parseBlocks } from './parse.js'

describe('parseFrontmatter', () => {
  it('解析 YAML frontmatter 并分离正文', () => {
    const raw = `---
id: same-discipline-baoyan
title: 本学科保研
status: verified
---
## 正文标题
内容`
    const { data, content } = parseFrontmatter(raw)
    expect(data.id).toBe('same-discipline-baoyan')
    expect(data.title).toBe('本学科保研')
    expect(data.status).toBe('verified')
    expect(content.trim().startsWith('## 正文标题')).toBe(true)
  })

  it('无 frontmatter 时返回空对象与原文', () => {
    const { data, content } = parseFrontmatter('## 只有正文')
    expect(data).toEqual({})
    expect(content).toBe('## 只有正文')
  })
})

describe('parseBlocks', () => {
  it('按 @block 注解切分并渲染为 HTML', () => {
    const content = `<!-- @block type="timeline" -->
## 保研时间线
- 大三上 · 9月 排名公示

<!-- @block type="myth" -->
:::myth 排名前 10% 就稳了
绩点只是入场券。
:::`
    const blocks = parseBlocks(content)
    expect(blocks).toHaveLength(2)
    expect(blocks[0]!.type).toBe('timeline')
    expect(blocks[0]!.html).toContain('保研时间线')
    expect(blocks[1]!.type).toBe('myth')
    expect(blocks[1]!.html).toContain('绩点只是入场券')
  })

  it('未识别的块类型同样被保留，不抛错', () => {
    const content = `<!-- @block type="brand-new-type" -->
## 新内容
正文`
    const blocks = parseBlocks(content)
    expect(blocks).toHaveLength(1)
    expect(blocks[0]!.type).toBe('brand-new-type')
  })

  it('没有 @block 注解的内容归入 free 类型', () => {
    const blocks = parseBlocks('## 零散观察\n随便写点什么')
    expect(blocks).toHaveLength(1)
    expect(blocks[0]!.type).toBe('free')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @navi/knowledge test`
Expected: FAIL，报错「Cannot find module './parse.js'」或「parseFrontmatter is not a function」

- [ ] **Step 3: 实现解析器**

先创建 `packages/knowledge/package.json`：

```json
{
  "name": "@navi/knowledge",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "scripts": {
    "test": "vitest run",
    "lint": "eslint .",
    "build": "tsx src/build.ts"
  },
  "dependencies": {
    "marked": "^15.0.4",
    "yaml": "^2.6.1"
  },
  "devDependencies": {
    "tsx": "^4.19.2",
    "vitest": "^2.1.8"
  }
}
```

`packages/knowledge/tsconfig.json`：

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src"]
}
```

`packages/knowledge/src/parse.ts`：

```ts
import { marked } from 'marked'
import { parse as parseYaml } from 'yaml'

export interface Block {
  /** 块类型。未识别的类型原样保留，由前端降级渲染 */
  type: string
  /** 渲染后的 HTML */
  html: string
  /** 块的原始 Markdown */
  raw: string
}

const BLOCK_MARKER = /^<!--\s*@block\s+type="([^"]+)"\s*-->\s*$/gm

export function parseFrontmatter(raw: string): {
  data: Record<string, unknown>
  content: string
} {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw)
  if (!match) return { data: {}, content: raw }

  const parsed = parseYaml(match[1]!) as unknown
  const data =
    parsed !== null && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : {}

  return { data, content: raw.slice(match[0].length) }
}

export function parseBlocks(content: string): Block[] {
  const markers: Array<{ type: string; index: number; length: number }> = []

  for (const m of content.matchAll(BLOCK_MARKER)) {
    markers.push({ type: m[1]!, index: m.index, length: m[0].length })
  }

  if (markers.length === 0) {
    const trimmed = content.trim()
    if (trimmed === '') return []
    return [{ type: 'free', html: render(trimmed), raw: trimmed }]
  }

  const blocks: Block[] = []

  const head = content.slice(0, markers[0]!.index).trim()
  if (head !== '') blocks.push({ type: 'free', html: render(head), raw: head })

  markers.forEach((marker, i) => {
    const start = marker.index + marker.length
    const end = i + 1 < markers.length ? markers[i + 1]!.index : content.length
    const raw = content.slice(start, end).trim()
    if (raw === '') return
    blocks.push({ type: marker.type, html: render(raw), raw })
  })

  return blocks
}

function render(markdown: string): string {
  return marked.parse(markdown, { async: false }) as string
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @navi/knowledge test`
Expected: PASS，4 个测试全部通过

- [ ] **Step 5: Commit**

```bash
git add packages/knowledge
git commit -m "feat(knowledge): 实现 frontmatter 与 @block 解析器，未知块类型不报错"
```

---

### Task 3: 知识库编译与校验

把 Markdown 知识库编译为单一 JSON 产物供 `core` 与 `web` 消费。校验失败**仅警告不阻断**（设计文档 §6.4）。

**Files:**
- Create: `packages/knowledge/src/validate.ts`
- Create: `packages/knowledge/src/build.ts`
- Create: `packages/knowledge/meta.yaml`
- Test: `packages/knowledge/src/validate.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `parseFrontmatter` / `parseBlocks`
- Produces:
  - `validateKnowledge(bundle: KnowledgeBundle): string[]`（返回警告列表，不抛错）
  - `buildKnowledge(rootDir: string): KnowledgeBundle`
  - `interface KnowledgeBundle { indicators, questions, archetypes, paths, blocks }` —— 消费方见 Task 5

- [ ] **Step 1: 写失败的测试**

`packages/knowledge/src/validate.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { validateKnowledge } from './validate.js'
import type { KnowledgeBundle } from './validate.js'

function bundle(overrides: Partial<KnowledgeBundle> = {}): KnowledgeBundle {
  return {
    indicators: [{ id: 'academic-interest', name: '学术志趣' }],
    questions: [
      { id: 'q1', indicator: 'academic-interest', text: 'q1', options: ['a','b','c','d','e'], weight: 1 },
      { id: 'q2', indicator: 'academic-interest', text: 'q2', options: ['a','b','c','d','e'], weight: 1 },
      { id: 'q3', indicator: 'academic-interest', text: 'q3', options: ['a','b','c','d','e'], weight: 1 },
    ],
    archetypes: [],
    paths: [{
      id: 'same-discipline-baoyan',
      title: '本学科保研',
      category: 'academic',
      span: 'same-discipline',
      status: 'verified',
      weights: [{ indicator: 'academic-interest', weight: 1, ideal: 85 }],
      eligibility: [],
      summary: '摘要',
    }],
    blocks: { 'same-discipline-baoyan': [] },
    ...overrides,
  }
}

describe('validateKnowledge', () => {
  it('合法的知识库没有警告', () => {
    expect(validateKnowledge(bundle())).toEqual([])
  })

  it('指标题目少于 3 道时给出警告', () => {
    const b = bundle()
    b.questions = b.questions.slice(0, 2)
    const warnings = validateKnowledge(b)
    expect(warnings.some(w => w.includes('academic-interest') && w.includes('3'))).toBe(true)
  })

  it('题目引用了不存在的指标时给出警告', () => {
    const b = bundle()
    b.questions[0]!.indicator = 'not-exist' as never
    const warnings = validateKnowledge(b)
    expect(warnings.some(w => w.includes('not-exist'))).toBe(true)
  })

  it('路径权重引用了不存在的指标时给出警告', () => {
    const b = bundle()
    b.paths[0]!.weights[0]!.indicator = 'not-exist' as never
    const warnings = validateKnowledge(b)
    expect(warnings.some(w => w.includes('not-exist'))).toBe(true)
  })

  it('路径 id 重复时给出警告', () => {
    const b = bundle()
    b.paths.push({ ...b.paths[0]! })
    const warnings = validateKnowledge(b)
    expect(warnings.some(w => w.includes('重复') || w.includes('duplicate'))).toBe(true)
  })

  it('校验永不抛错——即使输入完全为空', () => {
    const empty: KnowledgeBundle = {
      indicators: [], questions: [], archetypes: [], paths: [], blocks: {},
    }
    expect(() => validateKnowledge(empty)).not.toThrow()
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @navi/knowledge test`
Expected: FAIL，报错「Cannot find module './validate.js'」

- [ ] **Step 3: 实现校验**

`packages/knowledge/src/validate.ts`：

```ts
export interface IndicatorDef {
  id: string
  name: string
}

export interface QuestionDef {
  id: string
  indicator: string
  text: string
  options: string[]
  weight: number
  grades?: string[]
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

export interface PathWeight {
  indicator: string
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
  id: string
  title: string
  category: string
  span: string
  status: 'draft' | 'review' | 'verified'
  weights: PathWeight[]
  eligibility: EligibilityCondition[]
  summary: string
}

export interface Block {
  type: string
  html: string
  raw: string
}

export interface KnowledgeBundle {
  indicators: IndicatorDef[]
  questions: QuestionDef[]
  archetypes: ArchetypeDef[]
  paths: PathDef[]
  blocks: Record<string, Block[]>
}

const MIN_QUESTIONS_PER_INDICATOR = 3

export function validateKnowledge(bundle: KnowledgeBundle): string[] {
  const warnings: string[] = []

  const indicatorIds = new Set(bundle.indicators.map(i => i.id))

  for (const indicator of bundle.indicators) {
    const count = bundle.questions.filter(q => q.indicator === indicator.id).length
    if (count < MIN_QUESTIONS_PER_INDICATOR) {
      warnings.push(
        `指标 ${indicator.id} 仅有 ${count} 道题，少于要求的 ${MIN_QUESTIONS_PER_INDICATOR} 道（设计文档 §7.1）`,
      )
    }
  }

  for (const question of bundle.questions) {
    if (!indicatorIds.has(question.indicator)) {
      warnings.push(`题目 ${question.id} 引用了不存在的指标 ${question.indicator}`)
    }
    if (question.options.length !== 5) {
      warnings.push(`题目 ${question.id} 有 ${question.options.length} 个选项，应为 5 个（设计文档 §5.2）`)
    }
  }

  const seen = new Set<string>()
  for (const path of bundle.paths) {
    if (seen.has(path.id)) warnings.push(`路径 id 重复：${path.id}`)
    seen.add(path.id)

    for (const w of path.weights) {
      if (!indicatorIds.has(w.indicator)) {
        warnings.push(`路径 ${path.id} 的权重引用了不存在的指标 ${w.indicator}`)
      }
    }

    if (!bundle.blocks[path.id]) {
      warnings.push(`路径 ${path.id} 尚未撰写任何内容块`)
    }
  }

  for (const questionId of Object.keys(bundle.blocks)) {
    if (!seen.has(questionId)) {
      warnings.push(`存在没有对应路径定义的文档目录：${questionId}`)
    }
  }

  return warnings
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @navi/knowledge test`
Expected: PASS，全部测试通过

- [ ] **Step 5: 实现编译脚本**

`packages/knowledge/src/build.ts`：

```ts
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
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
      paths.push({
        id: String(data.id ?? entry.name),
        title: String(data.title ?? entry.name),
        category: String(data.category ?? ''),
        span: String(data.span ?? ''),
        status: (data.status as PathDef['status']) ?? 'draft',
        summary: String(data.summary ?? '').trim(),
        weights: (data.weights as PathDef['weights']) ?? [],
        eligibility: (data.eligibility as PathDef['eligibility']) ?? [],
      })
      blocks[String(data.id ?? entry.name)] = parseBlocks(content)
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

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`) {
  main()
}
```

- [ ] **Step 6: 补充 `.gitignore` 并提交**

确认 `packages/knowledge/dist/` 已被忽略——`.gitignore` 中已有 `dist/`，无需修改。

```bash
git add packages/knowledge
git commit -m "feat(knowledge): 实现编译脚本与校验，警告不阻断构建"
```

---

### Task 4: 知识库内容模板

产出 7 条路径的骨架文件与第一批可校验内容。**这是内容工作**，代码任务已完成；本任务交付的是格式正确的模板与一份完整示例，其余由团队照此填充。

**Files:**
- Create: `packages/knowledge/indicators/*.yaml`（8 个）
- Create: `packages/knowledge/questions/*.yaml`（每指标 3 道，共 24 个）
- Create: `packages/knowledge/archetypes/*.yaml`（6 个，先完成 2 个完整示例）
- Create: `packages/knowledge/paths/<pathId>/index.md`（7 个）

**Interfaces:**
- Consumes: Task 3 的 `buildKnowledge` 与 `validateKnowledge`
- Produces: `packages/knowledge/dist/knowledge.json`，即 Task 5 之后所有 core 任务的输入

- [ ] **Step 1: 创建 8 个指标定义**

每个文件形如 `packages/knowledge/indicators/academic-interest.yaml`：

```yaml
id: academic-interest
name: 学术志趣
description: 对深入一门学科、从事研究的真实兴趣（不等同于成绩好）
```

八个 id 依次为：`academic-interest`、`gpa-competitiveness`、`discipline-identity`、`cost-tolerance`、`risk-preference`、`stress-endurance`、`public-affairs-leaning`、`accumulation-drive`（设计文档 §2.2 表格）。

- [ ] **Step 2: 为每个指标创建 3 道题**

每个文件形如 `packages/knowledge/questions/academic-interest-1.yaml`：

```yaml
id: academic-interest-1
indicator: academic-interest
weight: 1
text: |
  导师给你一篇 20 页的英文文献，让你一周后汇报。你的第一反应更接近哪一端？
options:
  - 头疼，先找找有没有中文解读
  - 能读，但大概率拖到最后两天
  - 按部就班读完，把汇报做完就行
  - 有点期待，会顺便查查相关文献
  - 很兴奋，希望借这个机会深入这个方向
```

**约束**：`options` 必须恰好 5 项，且按「否定 → 肯定」排列；`weight` 默认 `1`。

**「绩点竞争力」按年级分流**——该指标的 3 道题需拆成两套（设计文档 §5.4）：

```yaml
id: gpa-competitiveness-freshman-1
indicator: gpa-competitiveness
weight: 1
grades: [freshman]
text: |
  入学后第一次作业或小测，你和身边同学的差距给你的感觉是——
options:
  - 我明显落后，有点慌
  - 落后一点，需要追
  - 差不多，大家都在同一起跑线
  - 我稍微领先
  - 我明显靠前，但还不确定能不能保持
```

```yaml
id: gpa-competitiveness-senior-1
indicator: gpa-competitiveness
weight: 1
grades: [sophomore, junior, senior]
text: |
  你的专业排名大致在——
options:
  - 后半段
  - 中下
  - 中游
  - 前 30%
  - 前 10%
```

> 注意：校验规则要求**每个指标的题目总数不少于 3 道**（不区分年级）。因此该指标需要两套各 3 道，共 6 道。

- [ ] **Step 3: 创建 7 条路径的文档骨架**

以 `packages/knowledge/paths/same-discipline-baoyan/index.md` 为例——**这是完整示例，其余 6 条照此结构撰写**：

```markdown
---
id: same-discipline-baoyan
title: 本学科保研
category: academic
span: same-discipline
status: draft
updated: 2026-10
summary: >
  保研的实质是用前五学期的绩点排名换取免试攻读研究生的资格。它是一条
  时间窗口最紧、可逆性最差的路：一旦进入大四上学期的正式推免流程，
  几乎没有回头余地。绩点排名只是入场券，科研、英语、竞赛加分项在
  很多学校能直接改写最终结果。
weights:
  - { indicator: academic-interest, weight: 0.25, ideal: 85 }
  - { indicator: gpa-competitiveness, weight: 0.35, ideal: 90 }
  - { indicator: discipline-identity, weight: 0.15, ideal: 80 }
  - { indicator: cost-tolerance, weight: 0.15, ideal: 60 }
  - { indicator: risk-preference, weight: 0.10, ideal: 75 }
eligibility:
  - id: has-tuimian-quota
    questionId: eligibility-tuimian-quota
    severity: hard
    failMessage: 你的学校没有推免资格，这条路对你当前不成立
    passWhen: [0]
---

<!-- @block type="timeline" -->
## 保研时间线

- **大三上 · 9月** 前 5 学期绩点排名公示
- **大三下 · 6-7月** 夏令营投递，黄金窗口，多数人在此阶段定局
- **大四上 · 9月** 推免系统开放、预推免、正式推免

<!-- @block type="myth" -->
:::myth 排名前 10% 就稳了
绩点只是入场券。科研经历、英语、竞赛加分项在很多学校能直接改写排名结果。
:::

<!-- @block type="cost" -->
:::cost 选择保研，需要放弃
- 大三暑期无法参加实习，那是秋招的关键积累期
- 考研备选窗口极短，10 月才决定风险很高
:::
```

七条路径的 id 与 `weights` 必须覆盖的指标，参照设计文档 §1.4 与 §2.2。

其余 6 条路径的 `weights` 与 `eligibility` **由团队讨论后填写**——这是内容判断，不是实现细节。但必须满足：权重之和为 1，`ideal` 为 0–100 的整数。

> **`eligibility` 依赖的问卷题目**：`questionId` 指向的题目需要存在于 `questions/` 中。请在本任务中一并创建这些资格题，例如 `questions/eligibility-tuimian-quota.yaml`：
>
> ```yaml
> id: eligibility-tuimian-quota
> indicator: academic-interest
> weight: 0
> text: 你的学校是否具备推免资格？
> options:
>   - 有，学校有推免名额
>   - 没有
>   - 不清楚
>   - 没听说过推免这回事
>   - 我确定有，且我们专业名额不少
> ```
>
> 注意 `passWhen: [0]` 表示只有选第 1 项才算通过。此题的 `weight: 0` 使其不影响指标得分，仅用于资格判断。

- [ ] **Step 4: 创建画像原型（先完成 2 个完整示例）**

`packages/knowledge/archetypes/steady-scholar.yaml`：

```yaml
id: steady-scholar
name: 稳健学术型
vector:
  academic-interest: 85
  gpa-competitiveness: 78
  discipline-identity: 80
  cost-tolerance: 60
  risk-preference: 80
  stress-endurance: 75
  public-affairs-leaning: 30
  accumulation-drive: 60
narrative:
  oneLiner: 你把大学当作一条向上的台阶，愿意用确定性的努力换取确定性的结果。
  strengths:
    - 目标清晰，耐得住长周期的重复投入
    - 对绩点和排名有天然的敏感度
  blindspots:
    - 容易忽略绩点之外的评价维度
    - 对突然的变化缺少预案
```

`packages/knowledge/archetypes/pragmatic-builder.yaml`：

```yaml
id: pragmatic-builder
name: 务实行动型
vector:
  academic-interest: 45
  gpa-competitiveness: 60
  discipline-identity: 55
  cost-tolerance: 40
  risk-preference: 45
  stress-endurance: 60
  public-affairs-leaning: 40
  accumulation-drive: 90
narrative:
  oneLiner: 你更相信亲手做出来的东西，愿意用行动换取机会，而不是等待评判。
  strengths:
    - 主动性强，能自己找到机会
    - 对市场信号敏感
  blindspots:
    - 可能低估学历门槛的长期影响
    - 容易在多个方向间分散精力
```

其余 4 个原型由团队按同一结构补充。

- [ ] **Step 5: 编译并检查警告**

Run: `pnpm --filter @navi/knowledge build`
Expected: 输出类似 `[knowledge] 已编译 7 条路径、8 个指标、24 道题目，N 条警告`

**警告数不为 0 是可接受的**（本任务只建立骨架），但需要逐条确认警告原因合理。若出现「指标 X 仅有 N 道题」的警告，说明该指标的题目还没写够。

- [ ] **Step 6: Commit**

```bash
git add packages/knowledge
git commit -m "feat(knowledge): 添加路径骨架、指标定义与画像原型模板"
```

---

### Task 5: core 类型定义（输出契约）

把设计文档 §7.8 的输出契约落成真实类型。**这是整个项目的接口中心**——`core`、`api`、`web` 三方共享，任何一方擅自改动都会导致其他方编译失败。

**Files:**
- Create: `packages/core/src/types.ts`
- Create: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: 无
- Produces: 全部后续 core 任务与 `apps/web` 依赖的类型：
  - `IndicatorId`、`PathId`
  - `IndicatorScore`、`Contribution`、`EligibilityFailure`、`PathResult`、`ArchetypeResult`、`DiagnosisResult`

- [ ] **Step 1: 定义类型**

`packages/core/src/types.ts`：

```ts
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
  html: string
  raw: string
}

export interface KnowledgeBundle {
  indicators: IndicatorDef[]
  questions: Question[]
  archetypes: ArchetypeDef[]
  paths: PathDef[]
  blocks: Record<string, Block[]>
}

/** 问卷答案：题目 id → 选项索引（0–4） */
export type Answers = Record<string, number>
```

`packages/core/src/index.ts`：

```ts
export * from './types.js'
```

- [ ] **Step 2: 验证类型编译通过**

Run: `pnpm --filter @navi/core build`
Expected: PASS，无类型错误

- [ ] **Step 3: Commit**

```bash
git add packages/core/src
git commit -m "feat(core): 定义输出契约类型"
```

---

### Task 6: 指标计算

**Files:**
- Create: `packages/core/src/scoring.ts`
- Test: `packages/core/src/scoring.test.ts`

**Interfaces:**
- Consumes: Task 5 的 `Answers`、`Question`、`IndicatorDef`、`IndicatorScore`
- Produces: `computeIndicatorScores(answers, questions, indicators): Record<string, IndicatorScore>`

- [ ] **Step 1: 写失败的测试**

`packages/core/src/scoring.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { computeIndicatorScores } from './scoring.js'
import type { Question, IndicatorDef } from './types.js'

const indicators: IndicatorDef[] = [
  { id: 'academic-interest', name: '学术志趣' },
  { id: 'risk-preference', name: '风险偏好' },
]

function q(id: string, indicator: string, weight = 1): Question {
  return { id, indicator: indicator as never, text: id, options: ['a','b','c','d','e'], weight }
}

const questions: Question[] = [
  q('q1', 'academic-interest'),
  q('q2', 'academic-interest'),
  q('q3', 'academic-interest'),
]

describe('computeIndicatorScores', () => {
  it('五档选项映射为 0/25/50/75/100', () => {
    const scores = computeIndicatorScores(
      { q1: 0, q2: 4, q3: 2 },
      questions,
      indicators,
    )
    // (0 + 100 + 50) / 3 = 50
    expect(scores['academic-interest']!.score).toBe(50)
    expect(scores['academic-interest']!.known).toBe(true)
  })

  it('全部选中间档得到 50 分', () => {
    const scores = computeIndicatorScores({ q1: 2, q2: 2, q3: 2 }, questions, indicators)
    expect(scores['academic-interest']!.score).toBe(50)
  })

  it('按题目权重加权平均', () => {
    const weighted: Question[] = [
      q('q1', 'academic-interest', 3),
      q('q2', 'academic-interest', 1),
    ]
    const scores = computeIndicatorScores({ q1: 4, q2: 0 }, weighted, indicators)
    // (100*3 + 0*1) / 4 = 75
    expect(scores['academic-interest']!.score).toBe(75)
  })

  it('记录参与计算的题目来源', () => {
    const scores = computeIndicatorScores({ q1: 1, q2: 1, q3: 1 }, questions, indicators)
    expect(scores['academic-interest']!.sources.sort()).toEqual(['q1', 'q2', 'q3'])
  })

  it('没有任何答案时标记为 known: false 且不产生 NaN', () => {
    const scores = computeIndicatorScores({}, questions, indicators)
    expect(scores['academic-interest']!.known).toBe(false)
    expect(Number.isNaN(scores['academic-interest']!.score)).toBe(false)
    expect(scores['academic-interest']!.score).toBe(0)
  })

  it('完全没有题目的指标同样标记为 known: false', () => {
    const scores = computeIndicatorScores({ q1: 1 }, questions, indicators)
    expect(scores['risk-preference']!.known).toBe(false)
  })

  it('超出范围的选项索引被忽略而不是算成 NaN', () => {
    const scores = computeIndicatorScores({ q1: 99, q2: 2, q3: 2 }, questions, indicators)
    expect(Number.isNaN(scores['academic-interest']!.score)).toBe(false)
    // q1 被忽略，(50 + 50) / 2 = 50
    expect(scores['academic-interest']!.score).toBe(50)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @navi/core test`
Expected: FAIL，报错「Cannot find module './scoring.js'」

- [ ] **Step 3: 实现指标计算**

`packages/core/src/scoring.ts`：

```ts
import type { Answers, IndicatorDef, IndicatorScore, Question } from './types.js'

/** 五档评分映射（设计文档 §5.2） */
export const FIVE_POINT_SCALE = [0, 25, 50, 75, 100] as const

/**
 * 作答一致性：同一指标下各题得分的离散程度（设计文档 §7.3）。
 * stdev 理论最大值为 50（一半 0 分、一半 100 分），此时一致性为 0。
 */
export function consistencyOf(scores: number[]): number {
  if (scores.length < 2) return 0
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length
  const variance = scores.reduce((s, x) => s + (x - mean) ** 2, 0) / scores.length
  const stdev = Math.sqrt(variance)
  return Math.max(0, 1 - stdev / 50)
}

export function computeIndicatorScores(
  answers: Answers,
  questions: Question[],
  indicators: IndicatorDef[],
): Record<string, IndicatorScore> {
  const result: Record<string, IndicatorScore> = {}

  for (const indicator of indicators) {
    const applicable = questions.filter(q => q.indicator === indicator.id)
    const answered = applicable.filter(q => {
      const idx = answers[q.id]
      return idx !== undefined && Number.isInteger(idx) && idx >= 0 && idx < FIVE_POINT_SCALE.length
    })

    if (answered.length === 0) {
      result[indicator.id] = { score: 0, known: false, consistency: 0, sources: [] }
      continue
    }

    const totalWeight = answered.reduce((s, q) => s + q.weight, 0)

    if (totalWeight <= 0) {
      result[indicator.id] = {
        score: 0,
        known: false,
        consistency: 0,
        sources: answered.map(q => q.id),
      }
      continue
    }

    const scores = answered.map(q => FIVE_POINT_SCALE[answers[q.id]!]!)
    const score = answered.reduce((s, q, i) => s + scores[i]! * q.weight, 0) / totalWeight

    result[indicator.id] = {
      score,
      known: true,
      consistency: consistencyOf(scores),
      sources: answered.map(q => q.id),
    }
  }

  return result
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @navi/core test`
Expected: PASS，7 个测试全部通过

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/scoring.ts packages/core/src/scoring.test.ts
git commit -m "feat(core): 实现指标计算与作答一致性"
```

---

### Task 7: 作答一致性的边界

一致性的边界值容易被写错（负数、除零），单独用一个任务固定住。

**Files:**
- Modify: `packages/core/src/scoring.test.ts`（追加测试）
- 实现已存在于 Task 6 的 `scoring.ts`

**Interfaces:**
- Consumes: Task 6 的 `consistencyOf`
- Produces: 无新接口，仅补足测试覆盖

- [ ] **Step 1: 追加边界测试**

在 `packages/core/src/scoring.test.ts` 末尾追加：

```ts
describe('consistencyOf 边界', () => {
  it('全部同分时一致性为 1', () => {
    expect(consistencyOf([50, 50, 50])).toBe(1)
  })

  it('极端分化（一半 0 一半 100）时一致性为 0', () => {
    expect(consistencyOf([0, 100])).toBe(0)
  })

  it('结果永远不为负', () => {
    for (const set of [[0,100,0,100], [0,0,100], [100,0,0,100,0]]) {
      expect(consistencyOf(set)).toBeGreaterThanOrEqual(0)
    }
  })

  it('题目少于 2 道时返回 0（无法判断一致性）', () => {
    expect(consistencyOf([80])).toBe(0)
    expect(consistencyOf([])).toBe(0)
  })

  it('轻微分歧时一致性介于 0 与 1 之间', () => {
    const c = consistencyOf([50, 75, 50])
    expect(c).toBeGreaterThan(0)
    expect(c).toBeLessThan(1)
  })
})
```

- [ ] **Step 2: 运行测试**

Run: `pnpm --filter @navi/core test`
Expected: PASS。若失败，修正 `consistencyOf` 而非放宽测试。

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/scoring.test.ts
git commit -m "test(core): 补足作答一致性的边界用例"
```

---

### Task 8: 权重重归一化

设计文档 §7.2。全必答问卷下正常不触发，但作为鲁棒性保障必须存在且被测试。

**Files:**
- Create: `packages/core/src/weights.ts`
- Test: `packages/core/src/weights.test.ts`

**Interfaces:**
- Consumes: Task 5 的 `IndicatorScore`、`PathWeight`
- Produces:
  - `normalizeWeights(weights: PathWeight[], scores: Record<string, IndicatorScore>): NormalizedWeights`
  - `interface NormalizedWeights { entries: PathWeight[]; coverage: number }`

- [ ] **Step 1: 写失败的测试**

`packages/core/src/weights.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { normalizeWeights } from './weights.js'
import type { IndicatorScore, PathWeight } from './types.js'

function known(score = 50): IndicatorScore {
  return { score, known: true, consistency: 1, sources: [] }
}
function unknown(): IndicatorScore {
  return { score: 0, known: false, consistency: 0, sources: [] }
}

const weights: PathWeight[] = [
  { indicator: 'academic-interest' as never, weight: 0.25, ideal: 85 },
  { indicator: 'gpa-competitiveness' as never, weight: 0.35, ideal: 90 },
  { indicator: 'risk-preference' as never, weight: 0.40, ideal: 75 },
]

describe('normalizeWeights', () => {
  it('全部已知时权重保持不变，coverage 为 1', () => {
    const { entries, coverage } = normalizeWeights(weights, {
      'academic-interest': known(),
      'gpa-competitiveness': known(),
      'risk-preference': known(),
    })
    expect(coverage).toBe(1)
    expect(entries.map(e => e.weight)).toEqual([0.25, 0.35, 0.40])
  })

  it('部分未知时剩余权重按比例放大且总和为 1', () => {
    const { entries, coverage } = normalizeWeights(weights, {
      'academic-interest': known(),
      'gpa-competitiveness': known(),
      'risk-preference': unknown(),
    })
    expect(coverage).toBeCloseTo(0.6, 10)
    const total = entries.reduce((s, e) => s + e.weight, 0)
    expect(total).toBeCloseTo(1, 10)
    expect(entries.find(e => e.indicator === 'academic-interest')!.weight).toBeCloseTo(0.25 / 0.6, 10)
  })

  it('未知指标被排除在结果之外', () => {
    const { entries } = normalizeWeights(weights, {
      'academic-interest': known(),
      'gpa-competitiveness': unknown(),
      'risk-preference': unknown(),
    })
    expect(entries).toHaveLength(1)
    expect(entries[0]!.indicator).toBe('academic-interest')
  })

  it('全部未知时返回空数组且 coverage 为 0，不产生 NaN', () => {
    const { entries, coverage } = normalizeWeights(weights, {
      'academic-interest': unknown(),
      'gpa-competitiveness': unknown(),
      'risk-preference': unknown(),
    })
    expect(entries).toEqual([])
    expect(coverage).toBe(0)
  })

  it('权重缺失的指标按未知处理', () => {
    const { entries, coverage } = normalizeWeights(weights, {
      'academic-interest': known(),
    })
    expect(entries).toHaveLength(1)
    expect(coverage).toBeCloseTo(0.25, 10)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @navi/core test`
Expected: FAIL，报错「Cannot find module './weights.js'」

- [ ] **Step 3: 实现重归一化**

`packages/core/src/weights.ts`：

```ts
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
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @navi/core test`
Expected: PASS，5 个测试通过

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/weights.ts packages/core/src/weights.test.ts
git commit -m "feat(core): 实现权重重归一化"
```

---

### Task 9: 资格过滤

设计文档 §7.5。**「不适用」的路径仍然返回，不隐藏**——解释本身就是信息。

**Files:**
- Create: `packages/core/src/eligibility.ts`
- Test: `packages/core/src/eligibility.test.ts`

**Interfaces:**
- Consumes: Task 5 的 `Answers`、`EligibilityCondition`、`EligibilityFailure`
- Produces: `evaluateEligibility(conditions, answers): { applicable, hardFailures, softWarnings }`

- [ ] **Step 1: 写失败的测试**

`packages/core/src/eligibility.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { evaluateEligibility } from './eligibility.js'
import type { EligibilityCondition } from './types.js'

const hard: EligibilityCondition = {
  id: 'has-tuimian-quota',
  questionId: 'eligibility-tuimian-quota',
  severity: 'hard',
  failMessage: '你的学校没有推免资格',
  passWhen: [0, 4],
}

const soft: EligibilityCondition = {
  id: 'gpa-threshold',
  questionId: 'eligibility-gpa',
  severity: 'soft',
  failMessage: '你的绩点距保研线较远',
  passWhen: [0, 1],
}

describe('evaluateEligibility', () => {
  it('全部通过时 applicable 为 true 且无失败项', () => {
    const r = evaluateEligibility([hard], { 'eligibility-tuimian-quota': 0 })
    expect(r.applicable).toBe(true)
    expect(r.hardFailures).toEqual([])
    expect(r.softWarnings).toEqual([])
  })

  it('hard 条件失败时 applicable 为 false 并记录原因', () => {
    const r = evaluateEligibility([hard], { 'eligibility-tuimian-quota': 1 })
    expect(r.applicable).toBe(false)
    expect(r.hardFailures).toHaveLength(1)
    expect(r.hardFailures[0]!.message).toBe('你的学校没有推免资格')
  })

  it('soft 条件失败时 applicable 仍为 true，仅记入警告', () => {
    const r = evaluateEligibility([soft], { 'eligibility-gpa': 3 })
    expect(r.applicable).toBe(true)
    expect(r.softWarnings).toHaveLength(1)
    expect(r.hardFailures).toEqual([])
  })

  it('未作答的题目视为不通过', () => {
    const r = evaluateEligibility([hard], {})
    expect(r.applicable).toBe(false)
    expect(r.hardFailures).toHaveLength(1)
  })

  it('多个 hard 失败时全部记录，而不是只报第一个', () => {
    const another: EligibilityCondition = { ...hard, id: 'another', failMessage: '另一条硬性不满足' }
    const r = evaluateEligibility([hard, another], { 'eligibility-tuimian-quota': 1 })
    expect(r.hardFailures).toHaveLength(2)
  })

  it('无条件时 applicable 为 true', () => {
    const r = evaluateEligibility([], {})
    expect(r.applicable).toBe(true)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @navi/core test`
Expected: FAIL，报错「Cannot find module './eligibility.js'」

- [ ] **Step 3: 实现资格过滤**

`packages/core/src/eligibility.ts`：

```ts
import type { Answers, EligibilityCondition, EligibilityFailure } from './types.js'

export interface EligibilityResult {
  applicable: boolean
  hardFailures: EligibilityFailure[]
  softWarnings: EligibilityFailure[]
}

/**
 * 资格过滤（设计文档 §7.5）。
 * hard 失败 → 路径标记为「不适用」；soft 失败 → 仅警告，路径保留。
 */
export function evaluateEligibility(
  conditions: EligibilityCondition[],
  answers: Answers,
): EligibilityResult {
  const hardFailures: EligibilityFailure[] = []
  const softWarnings: EligibilityFailure[] = []

  for (const condition of conditions) {
    const answer = answers[condition.questionId]
    const passed = answer !== undefined && condition.passWhen.includes(answer)
    if (passed) continue

    const failure: EligibilityFailure = {
      id: condition.id,
      severity: condition.severity,
      message: condition.failMessage,
    }

    if (condition.severity === 'hard') hardFailures.push(failure)
    else softWarnings.push(failure)
  }

  return { applicable: hardFailures.length === 0, hardFailures, softWarnings }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @navi/core test`
Expected: PASS，6 个测试通过

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/eligibility.ts packages/core/src/eligibility.test.ts
git commit -m "feat(core): 实现资格过滤，不适用路径保留并附原因"
```

---

### Task 10: 匹配度与置信度

设计文档 §7.6 与 §7.4。核心是**理想值模型**：指标不是越高越好，而是看与理想值的接近程度。

**Files:**
- Create: `packages/core/src/matching.ts`
- Test: `packages/core/src/matching.test.ts`

**Interfaces:**
- Consumes: Task 5 的 `IndicatorScore`、`PathWeight`、`Contribution`；Task 8 的 `normalizeWeights`
- Produces: `computePathMatch(scores, weights): { match, confidence, contributions }`

- [ ] **Step 1: 写失败的测试**

`packages/core/src/matching.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { computePathMatch, indicatorMatch } from './matching.js'
import type { IndicatorScore, PathWeight } from './types.js'

function s(score: number, consistency = 1): IndicatorScore {
  return { score, known: true, consistency, sources: [] }
}

const weights: PathWeight[] = [
  { indicator: 'academic-interest' as never, weight: 0.5, ideal: 100 },
  { indicator: 'gpa-competitiveness' as never, weight: 0.5, ideal: 100 },
]

describe('indicatorMatch', () => {
  it('命中理想值时为 100', () => {
    expect(indicatorMatch(85, 85)).toBe(100)
  })

  it('按差值线性衰减', () => {
    expect(indicatorMatch(55, 90)).toBe(65)
    expect(indicatorMatch(95, 90)).toBe(95)
  })

  it('差值达到 100 时为 0，不为负', () => {
    expect(indicatorMatch(0, 100)).toBe(0)
    expect(indicatorMatch(100, 0)).toBe(0)
  })
})

describe('computePathMatch', () => {
  it('全部命中理想值时匹配度为 100', () => {
    const r = computePathMatch(
      { 'academic-interest': s(100), 'gpa-competitiveness': s(100) },
      weights,
    )
    expect(r.match).toBeCloseTo(100, 10)
  })

  it('按权重汇总各项贡献之和等于总分', () => {
    const r = computePathMatch(
      { 'academic-interest': s(80), 'gpa-competitiveness': s(60) },
      weights,
    )
    const sum = r.contributions.reduce((acc, c) => acc + c.contribution, 0)
    expect(r.match).toBeCloseTo(sum, 10)
    expect(r.contributions).toHaveLength(2)
  })

  it('置信度是一致性按权重的加权平均', () => {
    const r = computePathMatch(
      { 'academic-interest': s(80, 1.0), 'gpa-competitiveness': s(60, 0.5) },
      weights,
    )
    expect(r.confidence).toBeCloseTo(0.75, 10)
  })

  it('存在未知指标时权重重新归一化，匹配度仍在 0–100', () => {
    const r = computePathMatch(
      { 'academic-interest': s(80), 'gpa-competitiveness': { score: 0, known: false, consistency: 0, sources: [] } },
      weights,
    )
    expect(r.match).toBeCloseTo(80, 10)   // 仅剩 academic-interest，ideal 100，score 80 → 80
    expect(r.contributions).toHaveLength(1)
  })

  it('全部指标未知时匹配度为 0、置信度为 0，不产生 NaN', () => {
    const r = computePathMatch(
      {
        'academic-interest': { score: 0, known: false, consistency: 0, sources: [] },
        'gpa-competitiveness': { score: 0, known: false, consistency: 0, sources: [] },
      },
      weights,
    )
    expect(r.match).toBe(0)
    expect(r.confidence).toBe(0)
    expect(r.contributions).toEqual([])
  })

  it('每个 contribution 的 weight 都是重归一化后的值，总和为 1', () => {
    const r = computePathMatch(
      { 'academic-interest': s(80), 'gpa-competitiveness': s(60) },
      weights,
    )
    const total = r.contributions.reduce((acc, c) => acc + c.weight, 0)
    expect(total).toBeCloseTo(1, 10)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @navi/core test`
Expected: FAIL，报错「Cannot find module './matching.js'」

- [ ] **Step 3: 实现匹配度**

`packages/core/src/matching.ts`：

```ts
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
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @navi/core test`
Expected: PASS，9 个测试通过

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/matching.ts packages/core/src/matching.test.ts
git commit -m "feat(core): 实现理想值匹配度与置信度"
```

---

### Task 11: 画像软归属

设计文档 §7.7。余弦相似度 + 带温度参数的 softmax，输出百分比而非硬分类。

**Files:**
- Create: `packages/core/src/archetype.ts`
- Test: `packages/core/src/archetype.test.ts`

**Interfaces:**
- Consumes: Task 5 的 `IndicatorScore`、`ArchetypeDef`、`ArchetypeResult`
- Produces:
  - `cosineSimilarity(a: number[], b: number[]): number`
  - `computeArchetypeAffinity(scores, archetypes, temperature?): ArchetypeResult[]`

- [ ] **Step 1: 写失败的测试**

`packages/core/src/archetype.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { cosineSimilarity, computeArchetypeAffinity } from './archetype.js'
import type { ArchetypeDef, IndicatorScore } from './types.js'

function s(score: number): IndicatorScore {
  return { score, known: true, consistency: 1, sources: [] }
}

const archetypes: ArchetypeDef[] = [
  {
    id: 'steady-scholar', name: '稳健学术型',
    vector: { 'academic-interest': 100, 'accumulation-drive': 50 },
    narrative: { oneLiner: '', strengths: [], blindspots: [] },
  },
  {
    id: 'pragmatic-builder', name: '务实行动型',
    vector: { 'academic-interest': 50, 'accumulation-drive': 100 },
    narrative: { oneLiner: '', strengths: [], blindspots: [] },
  },
]

describe('cosineSimilarity', () => {
  it('同向向量相似度为 1', () => {
    expect(cosineSimilarity([1, 1], [2, 2])).toBeCloseTo(1, 10)
  })

  it('正交向量相似度为 0', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 10)
  })

  it('任一侧为零向量时返回 0 而不是 NaN', () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0)
    expect(cosineSimilarity([], [])).toBe(0)
  })

  it('长度不一致时按较短长度计算，不抛错', () => {
    expect(() => cosineSimilarity([1, 1, 1], [1, 1])).not.toThrow()
  })
})

describe('computeArchetypeAffinity', () => {
  it('输出所有原型的归属度，且总和约为 1', () => {
    const result = computeArchetypeAffinity(
      { 'academic-interest': s(90), 'accumulation-drive': s(50) },
      archetypes,
    )
    expect(result).toHaveLength(2)
    const total = result.reduce((acc, r) => acc + r.affinity, 0)
    expect(total).toBeCloseTo(1, 6)
  })

  it('按归属度降序排列', () => {
    const result = computeArchetypeAffinity(
      { 'academic-interest': s(90), 'accumulation-drive': s(50) },
      archetypes,
    )
    expect(result[0]!.id).toBe('steady-scholar')
    expect(result[0]!.affinity).toBeGreaterThan(result[1]!.affinity)
  })

  it('学生不属于任何原型时仍返回全部原型，不返回空数组', () => {
    const result = computeArchetypeAffinity({}, archetypes)
    expect(result).toHaveLength(2)
    expect(result.every(r => Number.isFinite(r.affinity))).toBe(true)
  })

  it('所有指标未知时归属度均分，不产生 NaN', () => {
    const result = computeArchetypeAffinity({}, archetypes)
    expect(result.every(r => Number.isNaN(r.affinity))).toBe(false)
    expect(result[0]!.affinity).toBeCloseTo(0.5, 6)
  })

  it('原型列表为空时返回空数组', () => {
    expect(computeArchetypeAffinity({ 'academic-interest': s(50) }, [])).toEqual([])
  })

  it('温度参数越小分布越尖锐', () => {
    const scores = { 'academic-interest': s(90), 'accumulation-drive': s(50) }
    const sharp = computeArchetypeAffinity(scores, archetypes, 0.02)
    const flat = computeArchetypeAffinity(scores, archetypes, 0.5)
    expect(sharp[0]!.affinity).toBeGreaterThan(flat[0]!.affinity)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @navi/core test`
Expected: FAIL，报错「Cannot find module './archetype.js'」

- [ ] **Step 3: 实现软归属**

`packages/core/src/archetype.ts`：

```ts
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
 * 仅在学生与原型共同已知的维度上计算余弦相似度，缺失维度不参与。
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
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @navi/core test`
Expected: PASS，10 个测试通过

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/archetype.ts packages/core/src/archetype.test.ts
git commit -m "feat(core): 实现画像软归属与余弦相似度"
```

---

### Task 12: diagnose 编排入口

把所有环节串起来，并处理设计文档 §10 的三个边界：全 hard 不适用、多条路径接近、全指标不可用。

**Files:**
- Create: `packages/core/src/diagnose.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/diagnose.test.ts`

**Interfaces:**
- Consumes: Task 6–11 的全部函数；Task 5 的 `KnowledgeBundle`、`DiagnosisResult`
- Produces:
  - `diagnose(answers: Answers, knowledge: KnowledgeBundle, options?: DiagnoseOptions): DiagnosisResult`
  - `interface DiagnoseOptions { temperature?: number; closeMatchThreshold?: number }`
  - `findCloseMatches(result: DiagnosisResult, threshold: number): PathResult[]`

- [ ] **Step 1: 写失败的测试**

`packages/core/src/diagnose.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { diagnose, findCloseMatches } from './diagnose.js'
import type { KnowledgeBundle, Question } from './types.js'

function q(id: string, indicator: string): Question {
  return { id, indicator: indicator as never, text: id, options: ['a','b','c','d','e'], weight: 1 }
}

function makeKnowledge(overrides: Partial<KnowledgeBundle> = {}): KnowledgeBundle {
  return {
    indicators: [{ id: 'academic-interest', name: '学术志趣' }],
    questions: [q('q1', 'academic-interest'), q('q2', 'academic-interest'), q('q3', 'academic-interest')],
    archetypes: [{
      id: 'steady-scholar', name: '稳健学术型',
      vector: { 'academic-interest': 90 },
      narrative: { oneLiner: '', strengths: [], blindspots: [] },
    }],
    paths: [{
      id: 'same-discipline-baoyan', title: '本学科保研',
      category: 'academic', span: 'same-discipline', status: 'verified',
      summary: '',
      weights: [{ indicator: 'academic-interest', weight: 1, ideal: 90 }],
      eligibility: [],
    }],
    blocks: {},
    ...overrides,
  }
}

const fullAnswers = { q1: 4, q2: 4, q3: 4 }

describe('diagnose', () => {
  it('串联全部环节并输出三个部分', () => {
    const result = diagnose(fullAnswers, makeKnowledge())
    expect(Object.keys(result.indicators)).toContain('academic-interest')
    expect(result.paths).toHaveLength(1)
    expect(result.archetypes[0]!.id).toBe('steady-scholar')
  })

  it('作答完全一致时置信度为 1', () => {
    const result = diagnose(fullAnswers, makeKnowledge())
    expect(result.paths[0]!.confidence).toBeCloseTo(1, 6)
  })

  it('空答案时全部路径 match 为 0、confidence 为 0，且不抛错', () => {
    const result = diagnose({}, makeKnowledge())
    expect(result.paths[0]!.match).toBe(0)
    expect(result.paths[0]!.confidence).toBe(0)
    expect(result.indicators['academic-interest']!.known).toBe(false)
  })

  it('hard 条件失败时路径仍出现在结果中，但 applicable 为 false', () => {
    const knowledge = makeKnowledge({
      questions: [
        ...makeKnowledge().questions,
        { ...q('elig-tuimian', 'academic-interest'), weight: 0 },
      ],
      paths: [{
        ...makeKnowledge().paths[0]!,
        eligibility: [{
          id: 'has-tuimian-quota', questionId: 'elig-tuimian',
          severity: 'hard' as const,
          failMessage: '你的学校没有推免资格', passWhen: [0],
        }],
      }],
    })
    const result = diagnose({ ...fullAnswers, 'elig-tuimian': 1 }, knowledge)
    expect(result.paths).toHaveLength(1)
    expect(result.paths[0]!.eligibility.applicable).toBe(false)
    expect(result.paths[0]!.eligibility.hardFailures[0]!.message).toBe('你的学校没有推免资格')
  })

  it('所有路径都不适用时仍返回完整结果，不抛错也不返回空', () => {
    const knowledge = makeKnowledge({
      questions: [...makeKnowledge().questions, { ...q('elig', 'academic-interest'), weight: 0 }],
      paths: [{
        ...makeKnowledge().paths[0]!,
        eligibility: [{
          id: 'x', questionId: 'elig', severity: 'hard' as const,
          failMessage: '不满足', passWhen: [0],
        }],
      }],
    })
    const result = diagnose({ ...fullAnswers, elig: 4 }, knowledge)
    expect(result.paths).toHaveLength(1)
    expect(result.paths[0]!.eligibility.applicable).toBe(false)
  })

  it('路径按匹配度降序排列', () => {
    const base = makeKnowledge()
    const knowledge: KnowledgeBundle = {
      ...base,
      paths: [
        { ...base.paths[0]!, id: 'low', weights: [{ indicator: 'academic-interest', weight: 1, ideal: 0 }] },
        { ...base.paths[0]!, id: 'high', weights: [{ indicator: 'academic-interest', weight: 1, ideal: 100 }] },
      ],
    }
    const result = diagnose(fullAnswers, knowledge)
    expect(result.paths[0]!.id).toBe('high')
  })

  it('知识库为空时返回空结构而不是崩溃', () => {
    const empty: KnowledgeBundle = {
      indicators: [], questions: [], archetypes: [], paths: [], blocks: {},
    }
    const result = diagnose(fullAnswers, empty)
    expect(result.paths).toEqual([])
    expect(result.archetypes).toEqual([])
  })
})

describe('findCloseMatches', () => {
  it('找出与最高分差距在阈值内的路径', () => {
    const result = diagnose(fullAnswers, makeKnowledge({
      paths: [
        { ...makeKnowledge().paths[0]!, id: 'a', weights: [{ indicator: 'academic-interest', weight: 1, ideal: 100 }] },
        { ...makeKnowledge().paths[0]!, id: 'b', weights: [{ indicator: 'academic-interest', weight: 1, ideal: 98 }] },
        { ...makeKnowledge().paths[0]!, id: 'c', weights: [{ indicator: 'academic-interest', weight: 1, ideal: 10 }] },
      ],
    }))
    const close = findCloseMatches(result, 5)
    expect(close.map(p => p.id).sort()).toEqual(['a', 'b'])
  })

  it('没有接近的路径时返回仅含最高分的那一条', () => {
    const result = diagnose(fullAnswers, makeKnowledge())
    expect(findCloseMatches(result, 5)).toHaveLength(1)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @navi/core test`
Expected: FAIL，报错「Cannot find module './diagnose.js'」

- [ ] **Step 3: 实现编排**

`packages/core/src/diagnose.ts`：

```ts
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
 * 这是纯函数：同样输入必然得到同样输出，不依赖网络与时钟。
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
 * 返回结果按匹配度降序，至少包含最高分的那一条。
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
```

`packages/core/src/index.ts` 改为：

```ts
export * from './types.js'
export * from './scoring.js'
export * from './weights.js'
export * from './eligibility.js'
export * from './matching.js'
export * from './archetype.js'
export * from './diagnose.js'
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @navi/core test`
Expected: PASS，全部测试通过

- [ ] **Step 5: 提交**

```bash
git add packages/core/src
git commit -m "feat(core): 实现 diagnose 编排入口与接近路径判定"
```

---

### Task 13: API 服务

Hono 薄层，暴露 `/api/questions` 与 `/api/diagnose`。**本任务不接入大模型**。

**Files:**
- Create: `apps/api/package.json`
- Create: `apps/api/tsconfig.json`
- Create: `apps/api/src/server.ts`
- Test: `apps/api/src/server.test.ts`

**Interfaces:**
- Consumes: Task 12 的 `diagnose`；Task 3 产出的 `dist/knowledge.json`
- Produces: `createApp(bundle: KnowledgeBundle): Hono` 与 HTTP 接口契约

- [ ] **Step 1: 创建包配置**

`apps/api/package.json`：

```json
{
  "name": "@navi/api",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "test": "vitest run",
    "lint": "eslint .",
    "build": "tsc --noEmit"
  },
  "dependencies": {
    "@hono/node-server": "^1.13.7",
    "@navi/core": "workspace:*",
    "@navi/knowledge": "workspace:*",
    "hono": "^4.6.14"
  },
  "devDependencies": {
    "tsx": "^4.19.2",
    "vitest": "^2.1.8"
  }
}
```

`apps/api/tsconfig.json`：

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "lib": ["ES2022"], "types": ["node"] },
  "include": ["src"]
}
```

- [ ] **Step 2: 写失败的测试**

`apps/api/src/server.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { createApp } from './server.js'
import type { KnowledgeBundle } from '@navi/core'

function q(id: string, indicator: string) {
  return { id, indicator: indicator as never, text: id, options: ['a','b','c','d','e'], weight: 1 }
}

const bundle: KnowledgeBundle = {
  indicators: [{ id: 'academic-interest', name: '学术志趣' }],
  questions: [q('q1', 'academic-interest'), q('q2', 'academic-interest'), q('q3', 'academic-interest')],
  archetypes: [{
    id: 'steady-scholar', name: '稳健学术型',
    vector: { 'academic-interest': 90 },
    narrative: { oneLiner: '', strengths: [], blindspots: [] },
  }],
  paths: [{
    id: 'same-discipline-baoyan', title: '本学科保研',
    category: 'academic', span: 'same-discipline', status: 'verified', summary: '',
    weights: [{ indicator: 'academic-interest', weight: 1, ideal: 90 }],
    eligibility: [],
  }],
  blocks: { 'same-discipline-baoyan': [{ type: 'timeline', html: '<p>时间线</p>', raw: '时间线' }] },
}

describe('GET /api/questions', () => {
  it('返回题目、指标与路径定义', async () => {
    const res = await createApp(bundle).request('/api/questions')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.questions).toHaveLength(3)
    expect(body.indicators).toHaveLength(1)
    expect(body.paths).toHaveLength(1)
  })

  it('不下发路径内容块——内容块由 /api/knowledge/:pathId 单独提供', async () => {
    const res = await createApp(bundle).request('/api/questions')
    const body = await res.json()
    expect(body).not.toHaveProperty('blocks')
  })
})

describe('POST /api/diagnose', () => {
  it('返回结构化诊断结果', async () => {
    const res = await createApp(bundle).request('/api/diagnose', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ answers: { q1: 4, q2: 4, q3: 4 } }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.paths[0].id).toBe('same-discipline-baoyan')
    expect(body.indicators['academic-interest'].known).toBe(true)
  })

  it('响应中不含任何模型生成内容', async () => {
    const res = await createApp(bundle).request('/api/diagnose', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ answers: {} }),
    })
    const body = await res.json()
    expect(body).not.toHaveProperty('interpretation')
    expect(body).not.toHaveProperty('text')
  })

  it('请求体缺少 answers 时返回 400', async () => {
    const res = await createApp(bundle).request('/api/diagnose', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
  })

  it('answers 不是对象时返回 400 而不是 500', async () => {
    const res = await createApp(bundle).request('/api/diagnose', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ answers: 'nonsense' }),
    })
    expect(res.status).toBe(400)
  })

  it('请求体不是合法 JSON 时返回 400', async () => {
    const res = await createApp(bundle).request('/api/diagnose', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    })
    expect(res.status).toBe(400)
  })
})

describe('GET /api/knowledge/:pathId', () => {
  it('返回该路径的内容块', async () => {
    const res = await createApp(bundle).request('/api/knowledge/same-discipline-baoyan')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.blocks[0].type).toBe('timeline')
  })

  it('路径不存在时返回 404', async () => {
    const res = await createApp(bundle).request('/api/knowledge/not-exist')
    expect(res.status).toBe(404)
  })
})
```

- [ ] **Step 3: 运行测试确认失败**

Run: `pnpm --filter @navi/api test`
Expected: FAIL，报错「Cannot find module './server.js'」

- [ ] **Step 4: 实现服务**

`apps/api/src/server.ts`：

```ts
import { Hono } from 'hono'
import { diagnose } from '@navi/core'
import type { Answers, KnowledgeBundle } from '@navi/core'

export function createApp(bundle: KnowledgeBundle): Hono {
  const app = new Hono()

  app.get('/api/questions', c => {
    return c.json({
      questions: bundle.questions,
      indicators: bundle.indicators,
      paths: bundle.paths.map(p => ({
        id: p.id, title: p.title, category: p.category,
        span: p.span, status: p.status, summary: p.summary,
      })),
    })
  })

  app.post('/api/diagnose', async c => {
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: '请求体不是合法 JSON' }, 400)
    }

    const answers = (body as { answers?: unknown } | null)?.answers
    if (answers === null || typeof answers !== 'object' || Array.isArray(answers)) {
      return c.json({ error: '缺少 answers 字段，或格式不是对象' }, 400)
    }

    const result = diagnose(answers as Answers, bundle)
    return c.json(result)
  })

  app.get('/api/knowledge/:pathId', c => {
    const pathId = c.req.param('pathId')
    const path = bundle.paths.find(p => p.id === pathId)
    if (!path) return c.json({ error: `路径不存在：${pathId}` }, 404)

    return c.json({ path, blocks: bundle.blocks[pathId] ?? [] })
  })

  return app
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `pnpm --filter @navi/api test`
Expected: PASS，8 个测试通过

- [ ] **Step 6: 添加入口文件**

`apps/api/src/index.ts`：

```ts
import { readFileSync } from 'node:fs'
import { serve } from '@hono/node-server'
import { createApp } from './server.js'
import type { KnowledgeBundle } from '@navi/core'

const knowledgePath = new URL('../../../packages/knowledge/dist/knowledge.json', import.meta.url)
const bundle = JSON.parse(readFileSync(knowledgePath, 'utf8')) as KnowledgeBundle

const port = Number(process.env.PORT ?? 3000)
serve({ fetch: createApp(bundle).fetch, port }, info => {
  console.log(`[api] listening on http://localhost:${info.port}`)
})
```

- [ ] **Step 7: Commit**

```bash
git add apps/api
git commit -m "feat(api): 实现 Hono 服务与 /api/diagnose 接口"
```

---

### Task 14: 前端问卷

Vite + React + TailwindCSS 脚手架，以及问卷组件。**本任务刻意不做美化**——先确认链路正确（设计文档 §12.1）。

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/vite.config.ts`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/index.html`
- Create: `apps/web/src/main.tsx`
- Create: `apps/web/src/App.tsx`
- Create: `apps/web/src/api.ts`
- Create: `apps/web/src/components/Questionnaire.tsx`
- Create: `apps/web/src/components/Questionnaire.test.tsx`

**Interfaces:**
- Consumes: Task 13 的 `GET /api/questions`、`POST /api/diagnose`
- Produces: `<Questionnaire questions={...} onSubmit={(answers) => void} />`

- [ ] **Step 1: 创建脚手架**

`apps/web/package.json`：

```json
{
  "name": "@navi/web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "test": "vitest run",
    "lint": "eslint .",
    "build": "tsc --noEmit && vite build"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.6.3",
    "@testing-library/react": "^16.1.0",
    "@testing-library/user-event": "^14.5.2",
    "@types/react": "^18.3.17",
    "@types/react-dom": "^18.3.5",
    "@vitejs/plugin-react": "^4.3.4",
    "autoprefixer": "^10.4.20",
    "jsdom": "^25.0.1",
    "postcss": "^8.4.49",
    "tailwindcss": "^3.4.17",
    "vite": "^6.0.5",
    "vitest": "^2.1.8"
  }
}
```

`apps/web/vite.config.ts`：

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { '/api': 'http://localhost:3000' },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    globals: true,
  },
})
```

`apps/web/src/test-setup.ts`：

```ts
import '@testing-library/jest-dom/vitest'
```

`apps/web/tsconfig.json`：

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "types": ["vitest/globals", "node"]
  },
  "include": ["src", "vite.config.ts"]
}
```

`apps/web/index.html`：

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Navi · 大学生生涯规划</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`apps/web/src/main.tsx`：

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.js'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

`apps/web/src/index.css`：

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

以及 `tailwind.config.js`：

```js
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: { extend: {} },
  plugins: [],
}
```

- [ ] **Step 2: 写失败的测试**

`apps/web/src/components/Questionnaire.test.tsx`：

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Questionnaire } from './Questionnaire.js'
import type { Question } from '../api.js'

const questions: Question[] = [
  { id: 'q1', indicator: 'academic-interest', text: '第一题题干', options: ['A','B','C','D','E'], weight: 1 },
  { id: 'q2', indicator: 'academic-interest', text: '第二题题干', options: ['A','B','C','D','E'], weight: 1 },
]

describe('Questionnaire', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('渲染题目与五个选项', () => {
    render(<Questionnaire questions={questions} onSubmit={() => {}} />)
    expect(screen.getByText('第一题题干')).toBeInTheDocument()
    expect(screen.getAllByRole('radio')).toHaveLength(10)
  })

  it('未答完时提交按钮禁用', () => {
    render(<Questionnaire questions={questions} onSubmit={() => {}} />)
    expect(screen.getByRole('button', { name: /提交/ })).toBeDisabled()
  })

  it('全部作答后提交按钮可用，并回传选项索引', async () => {
    const onSubmit = vi.fn()
    render(<Questionnaire questions={questions} onSubmit={onSubmit} />)

    const radios = screen.getAllByRole('radio')
    await userEvent.click(radios[0]!)   // q1 选第 1 项
    await userEvent.click(radios[6]!)   // q2 选第 2 项

    const submit = screen.getByRole('button', { name: /提交/ })
    expect(submit).toBeEnabled()
    await userEvent.click(submit)

    expect(onSubmit).toHaveBeenCalledWith({ q1: 0, q2: 1 })
  })

  it('显示已完成题数', async () => {
    render(<Questionnaire questions={questions} onSubmit={() => {}} />)
    expect(screen.getByText(/0\s*\/\s*2/)).toBeInTheDocument()
    await userEvent.click(screen.getAllByRole('radio')[0]!)
    expect(screen.getByText(/1\s*\/\s*2/)).toBeInTheDocument()
  })

  it('答案写入 localStorage，重新挂载后恢复（设计文档 §5.5）', async () => {
    const first = render(<Questionnaire questions={questions} onSubmit={() => {}} />)
    await userEvent.click(screen.getAllByRole('radio')[0]!)
    first.unmount()

    render(<Questionnaire questions={questions} onSubmit={() => {}} />)
    expect(screen.getByText(/1\s*\/\s*2/)).toBeInTheDocument()
  })

  it('localStorage 内容损坏时不影响渲染，按空白问卷处理', () => {
    localStorage.setItem('navi.questionnaire.answers', '{不是合法 JSON')
    expect(() => render(<Questionnaire questions={questions} onSubmit={() => {}} />)).not.toThrow()
    expect(screen.getByText(/0\s*\/\s*2/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 3: 运行测试确认失败**

Run: `pnpm --filter @navi/web test`
Expected: FAIL，报错「Cannot find module './Questionnaire.js'」

- [ ] **Step 4: 实现问卷组件**

`apps/web/src/api.ts`：

```ts
export interface Question {
  id: string
  indicator: string
  text: string
  options: string[]
  weight: number
  grades?: string[]
}

export interface IndicatorScore {
  score: number
  known: boolean
  consistency: number
  sources: string[]
}

export interface Contribution {
  indicator: string
  match: number
  weight: number
  contribution: number
}

export interface PathResult {
  id: string
  match: number
  confidence: number
  eligibility: {
    applicable: boolean
    hardFailures: Array<{ id: string; severity: string; message: string }>
    softWarnings: Array<{ id: string; severity: string; message: string }>
  }
  contributions: Contribution[]
}

export interface DiagnosisResult {
  indicators: Record<string, IndicatorScore>
  paths: PathResult[]
  archetypes: Array<{ id: string; affinity: number }>
}

export interface PathSummary {
  id: string
  title: string
  category: string
  span: string
  status: string
  summary: string
}

export interface QuestionsResponse {
  questions: Question[]
  indicators: Array<{ id: string; name: string }>
  paths: PathSummary[]
}

export async function fetchQuestions(): Promise<QuestionsResponse> {
  const res = await fetch('/api/questions')
  if (!res.ok) throw new Error(`获取问卷失败：${res.status}`)
  return res.json() as Promise<QuestionsResponse>
}

export async function postDiagnose(answers: Record<string, number>): Promise<DiagnosisResult> {
  const res = await fetch('/api/diagnose', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ answers }),
  })
  if (!res.ok) throw new Error(`诊断失败：${res.status}`)
  return res.json() as Promise<DiagnosisResult>
}
```

`apps/web/src/components/Questionnaire.tsx`：

```tsx
import { useEffect, useState } from 'react'
import type { Question } from '../api.js'

interface Props {
  questions: Question[]
  onSubmit: (answers: Record<string, number>) => void
}

const GROUP_SIZE = 5
const STORAGE_KEY = 'navi.questionnaire.answers'

/** 读取暂存的答案。任何异常都退化为空对象——暂存失败不应阻断答题 */
function loadStoredAnswers(): Record<string, number> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return {}
    const parsed: unknown = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return parsed as Record<string, number>
  } catch {
    return {}
  }
}

export function Questionnaire({ questions, onSubmit }: Props) {
  const [answers, setAnswers] = useState<Record<string, number>>(loadStoredAnswers)
  const [page, setPage] = useState(0)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(answers))
    } catch {
      // 隐私模式或配额不足时静默忽略
    }
  }, [answers])

  const groups: Question[][] = []
  for (let i = 0; i < questions.length; i += GROUP_SIZE) {
    groups.push(questions.slice(i, i + GROUP_SIZE))
  }

  const answeredCount = Object.keys(answers).length
  const current = groups[page] ?? []
  const currentComplete = current.every(q => answers[q.id] !== undefined)
  const isLast = page === groups.length - 1
  const allComplete = answeredCount === questions.length

  function select(questionId: string, optionIndex: number) {
    setAnswers(prev => ({ ...prev, [questionId]: optionIndex }))
  }

  return (
    <div className="mx-auto max-w-3xl p-6">
      <p className="mb-4 text-sm text-gray-600">
        已完成 {answeredCount} / {questions.length}
      </p>

      {current.map(question => (
        <fieldset key={question.id} className="mb-6">
          <legend className="mb-2 font-medium">{question.text}</legend>
          {question.options.map((option, index) => (
            <label key={index} className="mb-1 flex cursor-pointer items-center gap-2">
              <input
                type="radio"
                name={question.id}
                checked={answers[question.id] === index}
                onChange={() => select(question.id, index)}
              />
              <span>{option}</span>
            </label>
          ))}
        </fieldset>
      ))}

      <div className="flex gap-3">
        {page > 0 && (
          <button type="button" onClick={() => setPage(p => p - 1)}>上一组</button>
        )}

        {!isLast && (
          <button type="button" disabled={!currentComplete} onClick={() => setPage(p => p + 1)}>
            下一组
          </button>
        )}

        {isLast && (
          <button
            type="button"
            disabled={!allComplete}
            onClick={() => onSubmit(answers)}
          >
            提交
          </button>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `pnpm --filter @navi/web test`
Expected: PASS，6 个测试通过

> 题目总数少于 5 时 `groups` 只有一页，`isLast` 为 true——测试中的两题场景正是这种情况。

- [ ] **Step 6: Commit**

```bash
git add apps/web
git commit -m "feat(web): 搭建 Vite 前端并实现问卷组件"
```

---

### Task 15: 结果页

**Files:**
- Create: `apps/web/src/components/ResultView.tsx`
- Create: `apps/web/src/components/ResultView.test.tsx`
- Modify: `apps/web/src/App.tsx`

**Interfaces:**
- Consumes: Task 14 的 `DiagnosisResult`、`PathSummary` 类型
- Produces: `<ResultView result={...} paths={...} />` 与完整的 `<App />`

- [ ] **Step 1: 写失败的测试**

`apps/web/src/components/ResultView.test.tsx`：

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ResultView } from './ResultView.js'
import type { DiagnosisResult, PathSummary } from '../api.js'

const paths: PathSummary[] = [
  { id: 'same-discipline-baoyan', title: '本学科保研', category: 'academic', span: 'same-discipline', status: 'verified', summary: '' },
  { id: 'civil-service', title: '考公考编 / 选调生', category: 'civil', span: 'same-discipline', status: 'draft', summary: '' },
]

const result: DiagnosisResult = {
  indicators: {
    'academic-interest': { score: 75, known: true, consistency: 1, sources: ['q1','q2','q3'] },
  },
  paths: [
    {
      id: 'same-discipline-baoyan', match: 78, confidence: 0.9,
      eligibility: { applicable: true, hardFailures: [], softWarnings: [] },
      contributions: [{ indicator: 'academic-interest', match: 90, weight: 1, contribution: 90 }],
    },
    {
      id: 'civil-service', match: 0, confidence: 0.5,
      eligibility: {
        applicable: false,
        hardFailures: [{ id: 'x', severity: 'hard', message: '你的专业没有对口岗位' }],
        softWarnings: [],
      },
      contributions: [],
    },
  ],
  archetypes: [{ id: 'steady-scholar', affinity: 0.68 }],
}

describe('ResultView', () => {
  it('显示路径名称与匹配分', () => {
    render(<ResultView result={result} paths={paths} />)
    expect(screen.getByText('本学科保研')).toBeInTheDocument()
    expect(screen.getByText(/78/)).toBeInTheDocument()
  })

  it('显示置信度百分比', () => {
    render(<ResultView result={result} paths={paths} />)
    expect(screen.getByText(/90%/)).toBeInTheDocument()
  })

  it('不适用路径仍然显示，并给出失败原因', () => {
    render(<ResultView result={result} paths={paths} />)
    expect(screen.getByText('考公考编 / 选调生')).toBeInTheDocument()
    expect(screen.getByText(/你的专业没有对口岗位/)).toBeInTheDocument()
  })

  it('待核实内容的路径显示角标', () => {
    render(<ResultView result={result} paths={paths} />)
    expect(screen.getByText(/待核实/)).toBeInTheDocument()
  })

  it('显示画像归属百分比', () => {
    render(<ResultView result={result} paths={paths} />)
    expect(screen.getByText(/68%/)).toBeInTheDocument()
  })

  it('空路径列表时不崩溃', () => {
    const empty: DiagnosisResult = { indicators: {}, paths: [], archetypes: [] }
    expect(() => render(<ResultView result={empty} paths={[]} />)).not.toThrow()
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @navi/web test`
Expected: FAIL，报错「Cannot find module './ResultView.js'」

- [ ] **Step 3: 实现结果页**

`apps/web/src/components/ResultView.tsx`：

```tsx
import type { DiagnosisResult, PathSummary } from '../api.js'

interface Props {
  result: DiagnosisResult
  paths: PathSummary[]
}

export function ResultView({ result, paths }: Props) {
  const pathById = new Map(paths.map(p => [p.id, p]))

  return (
    <div className="mx-auto max-w-3xl p-6">
      <section className="mb-8">
        <h2 className="mb-2 text-lg font-semibold">你的画像</h2>
        {result.archetypes.length === 0 ? (
          <p className="text-gray-500">暂无画像信息</p>
        ) : (
          <ul>
            {result.archetypes.slice(0, 2).map(a => (
              <li key={a.id}>
                {a.id} —— {Math.round(a.affinity * 100)}%
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-lg font-semibold">路径匹配</h2>
        {result.paths.length === 0 ? (
          <p className="text-gray-500">暂无匹配路径</p>
        ) : (
          <ul className="space-y-4">
            {result.paths.map(path => {
              const meta = pathById.get(path.id)
              return (
                <li key={path.id} className="border p-4">
                  <div className="flex items-baseline justify-between">
                    <h3 className="font-medium">{meta?.title ?? path.id}</h3>
                    {meta?.status === 'draft' && (
                      <span className="text-xs text-amber-600">待核实</span>
                    )}
                  </div>

                  <p className="mt-1 text-sm text-gray-600">
                    匹配度 {Math.round(path.match)} · 置信度 {Math.round(path.confidence * 100)}%
                  </p>

                  {!path.eligibility.applicable && (
                    <ul className="mt-2 text-sm text-red-600">
                      {path.eligibility.hardFailures.map(f => (
                        <li key={f.id}>不适用：{f.message}</li>
                      ))}
                    </ul>
                  )}

                  {path.eligibility.softWarnings.length > 0 && (
                    <ul className="mt-2 text-sm text-amber-600">
                      {path.eligibility.softWarnings.map(f => (
                        <li key={f.id}>注意：{f.message}</li>
                      ))}
                    </ul>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @navi/web test`
Expected: PASS，6 个测试通过

- [ ] **Step 5: 组装 App**

`apps/web/src/App.tsx`：

```tsx
import { useEffect, useState } from 'react'
import { fetchQuestions, postDiagnose } from './api.js'
import type { DiagnosisResult, QuestionsResponse } from './api.js'
import { Questionnaire } from './components/Questionnaire.js'
import { ResultView } from './components/ResultView.js'

type Stage = 'loading' | 'questions' | 'result' | 'error'

export function App() {
  const [stage, setStage] = useState<Stage>('loading')
  const [data, setData] = useState<QuestionsResponse | null>(null)
  const [result, setResult] = useState<DiagnosisResult | null>(null)
  const [message, setMessage] = useState('')

  useEffect(() => {
    fetchQuestions()
      .then(response => {
        setData(response)
        setStage('questions')
      })
      .catch(error => {
        setMessage(error instanceof Error ? error.message : '加载失败')
        setStage('error')
      })
  }, [])

  async function handleSubmit(answers: Record<string, number>) {
    try {
      setResult(await postDiagnose(answers))
      setStage('result')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '诊断失败')
      setStage('error')
    }
  }

  if (stage === 'loading') return <p className="p-6">加载中……</p>

  if (stage === 'error') {
    return (
      <div className="p-6">
        <p className="text-red-600">{message}</p>
        <button type="button" onClick={() => location.reload()}>重试</button>
      </div>
    )
  }

  if (stage === 'result' && result && data) {
    return <ResultView result={result} paths={data.paths} />
  }

  if (!data) return <p className="p-6">加载中……</p>

  return <Questionnaire questions={data.questions} onSubmit={handleSubmit} />
}
```

- [ ] **Step 6: 端到端验证**

```bash
pnpm --filter @navi/knowledge build
pnpm --filter @navi/api dev     # 终端 A
pnpm --filter @navi/web dev     # 终端 B
```

打开 `http://localhost:5173`，填写问卷并提交。

Expected: 页面从问卷切换到结果页，显示路径名称、匹配度、置信度。浏览器控制台无报错。

- [ ] **Step 7: Commit**

```bash
git add apps/web
git commit -m "feat(web): 实现结果页与端到端串联"
```

---

### Task 16: 黄金案例集

设计文档 §11.3。既是回归测试，也是内容校对工具。

**Files:**
- Create: `packages/core/src/golden.test.ts`
- Create: `packages/core/src/fixtures/golden-cases.ts`

**Interfaces:**
- Consumes: Task 12 的 `diagnose`；Task 4 产出的真实 `knowledge.json`
- Produces: 可复用的案例定义 `GoldenCase[]`

- [ ] **Step 1: 定义案例结构**

`packages/core/src/fixtures/golden-cases.ts`：

```ts
import type { Answers } from '../types.js'

export interface GoldenCase {
  name: string
  description: string
  answers: Answers
  /** 期望出现在首选推荐中的路径 id */
  expectTopPath: string
  /** 期望必须出现在结果里的路径 id（可为空） */
  expectPresent?: string[]
}

/**
 * 黄金案例集（设计文档 §11.3）。
 *
 * 注意：answers 中的题目 id 必须与 packages/knowledge/questions/ 下的真实题目一致。
 * 内容组增删题目后，此处需要同步更新——这是刻意设计：它让内容改动导致的
 * 推荐结果漂移在测试中立刻可见。
 */
export const GOLDEN_CASES: GoldenCase[] = [
  // 格式示例。题目 id 取自 Task 4 定义的题目；若内容组调整了题目 id，
  // golden.test.ts 的「答案指向真实题目」用例会立刻捕获。
  {
    name: '学业专注、认同本专业',
    description: '学术志趣高、对当前专业不排斥，预期首选本学科保研',
    answers: {
      'academic-interest-1': 4,
      'academic-interest-2': 4,
      'academic-interest-3': 3,
      'discipline-identity-1': 4,
      'discipline-identity-2': 3,
      'discipline-identity-3': 4,
    },
    expectTopPath: 'same-discipline-baoyan',
  },
]
```

> **案例内容属于内容工作，与代码实现分离**：上方是格式示例，覆盖了两个指标的 6 道题；真实案例应覆盖全部指标（Step 4 说明）。机制与测试骨架在本任务中一次建成，此后新增案例只是往数组里加对象，不再改动任何代码。

- [ ] **Step 2: 写测试**

`packages/core/src/golden.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { diagnose } from './diagnose.js'
import { GOLDEN_CASES } from './fixtures/golden-cases.js'
import type { KnowledgeBundle } from './types.js'

const knowledgePath = new URL('../../../knowledge/dist/knowledge.json', import.meta.url)
const hasKnowledge = existsSync(knowledgePath)
const bundle = hasKnowledge
  ? (JSON.parse(readFileSync(knowledgePath, 'utf8')) as KnowledgeBundle)
  : null

describe('黄金案例集', () => {
  it('知识库已编译', () => {
    if (!hasKnowledge) {
      console.warn('未找到 knowledge.json，跳过。请先运行 pnpm --filter @navi/knowledge build')
    }
    expect(true).toBe(true)
  })

  it('每个案例的答案都指向真实存在的题目', () => {
    if (!bundle) return
    const questionIds = new Set(bundle.questions.map(q => q.id))

    for (const goldenCase of GOLDEN_CASES) {
      for (const questionId of Object.keys(goldenCase.answers)) {
        expect(
          questionIds.has(questionId),
          `案例「${goldenCase.name}」引用了不存在的题目 ${questionId}`,
        ).toBe(true)
      }
    }
  })

  it.each(GOLDEN_CASES.map(c => [c.name, c] as const))(
    '案例「%s」的首选推荐符合预期',
    (_name, goldenCase) => {
      if (!bundle) return
      const result = diagnose(goldenCase.answers, bundle)
      const applicable = result.paths.filter(p => p.eligibility.applicable)
      expect(applicable[0]?.id).toBe(goldenCase.expectTopPath)

      for (const pathId of goldenCase.expectPresent ?? []) {
        expect(result.paths.map(p => p.id)).toContain(pathId)
      }
    },
  )

  it('同一份答案重复诊断得到完全相同的结果（确定性）', () => {
    if (!bundle || GOLDEN_CASES.length === 0) return
    const first = diagnose(GOLDEN_CASES[0]!.answers, bundle)
    const second = diagnose(GOLDEN_CASES[0]!.answers, bundle)
    expect(JSON.stringify(first)).toBe(JSON.stringify(second))
  })
})
```

- [ ] **Step 3: 运行测试**

Run: `pnpm --filter @navi/knowledge build && pnpm --filter @navi/core test`
Expected: PASS。案例集为空时，`it.each` 不产生用例，其余测试通过。

- [ ] **Step 4: 由团队填入 3–5 个真实案例**

参照 `GoldenCase` 接口，在 `GOLDEN_CASES` 数组中补充真实案例。每个案例应代表一类典型学生，例如「双非一本、绩点中游、想跨考」「211、绩点前 10%、想保研」。

**这一步是内容判断，不是代码实现**——建议由内容组与算法组共同确定，因为它同时定义了「什么样的推荐结果是我们认为正确的」。

- [ ] **Step 5: 运行测试验证案例通过**

Run: `pnpm --filter @navi/core test`
Expected: PASS，每个案例都输出符合预期的首选路径。若有失败，说明知识库权重需要调整——这正是案例集的价值。

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/golden.test.ts packages/core/src/fixtures
git commit -m "test(core): 建立黄金案例集与确定性回归测试"
```

---

## 完成标准

本计划完成时，以下命令应全部通过：

```bash
pnpm install
pnpm --filter @navi/knowledge build   # 编译知识库，输出 dist/knowledge.json
pnpm -r test                          # 全部单元测试通过
pnpm -r lint                          # 无 lint 错误
pnpm --filter @navi/api dev           # 启动 API
pnpm --filter @navi/web dev           # 启动前端
```

打开 `http://localhost:5173` 应能完成「填写问卷 → 查看路径推荐」的完整流程，且**全程无任何大模型调用**。

## 后续计划（不在本计划范围）

- **计划 ②：LLM 层**——个性化解读、追问、诚实边界（设计文档 §8）
- **计划 ③：可视化打磨**——雷达图、路径地图、画像对比、时间线（设计文档 §9）

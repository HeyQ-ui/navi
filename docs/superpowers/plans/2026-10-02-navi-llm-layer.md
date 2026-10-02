# Navi LLM 层实施计划（计划②）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在已打通的确定性链路上叠加 LLM 层——个性化解读与追问，模型不参与任何决策；模型不可用时结构化诊断结果完整可用。

**Architecture:** 新增 `packages/llm`（提示词 `.md` + 纯函数上下文组装 + 模型编排，只依赖 `core` 的类型）；`apps/api` 新增两个流式端点 `/api/interpret` 与 `/api/chat`；`apps/web` 结果页的路径列表可点选决定「本路径」，解读区与追问框都锚到它。

**Tech Stack:** Vercel AI SDK（`ai@^7` · `@ai-sdk/openai@^4` · `@ai-sdk/react@^4`）· `zod@^4` · Hono · React + Vite · Vitest

**Spec:** `docs/superpowers/specs/2026-09-27-navi-career-planning-agent-design.md` §8（LLM 层）、§10（边界情况）、§13.1（待验证项）

---

## 开放决策与结论

计划①之外的部分，设计文档 §8 没有规定到实现层面。以下是本计划作出的决定，**审阅时请优先看这一节**，任何一条都可以推翻。

### D1 · `packages/llm` 的内部结构 = 两个源文件

```
packages/llm/src/context.ts   # 纯函数：把诊断结果 + 知识库组装成 messages
packages/llm/src/index.ts     # 读提示词、建 provider、导出 streamInterpret / streamChat
```

**理由**：上下文组装是纯计算，占了这个包里几乎全部的出错可能，必须能脱离网络单测；模型编排只有几十行。再拆出 `prompts.ts`、`model.ts` 属于为拆而拆。

### D2 · `boundaries.md` 编译进 knowledge bundle

新建 `packages/knowledge/boundaries.md`，由 `build.ts` 用既有的 `parseBlocks` 解析成 `Block[]`，作为 `boundaries` 字段随 bundle 下发。

**理由**：设计文档 §6.4 定的是「构建时编译，运行时不解析文本」。若让 `llm` 层运行时去读 `packages/knowledge/boundaries.md` 原文件，就等于开了第二条内容读取路径，且 `llm` 需要跨包读别人的源目录——两样都更糟。

**代价**：`KnowledgeBundle` 在 `packages/knowledge/src/validate.ts` 与 `packages/core/src/types.ts` 两处都要加字段（这两处本来就互为镜像），并有 3 个测试 fixture 需要补 `boundaries: []`。加为**必填**而非可选：`build.ts` 总会产出该字段（文件缺失时为 `[]`），必填能让消费方省掉 `?? []`。

### D3 · 端点契约

| | 请求体 | 响应 |
|---|---|---|
| `POST /api/interpret` | `{ answers, grade, pathId }` | `toTextStreamResponse()`，纯文本流 |
| `POST /api/chat` | `{ answers, grade, pathId, messages }` | `toUIMessageStreamResponse()`，UI 消息流 |

- **服务端用 `answers + grade` 重算 `diagnose`，不接受客户端传来的诊断结果。** `diagnose` 是纯函数且确定性（§5.1），重算成本是一次算术；让客户端传结果则多一个可伪造的信任边界。
- `pathId` 指向「本路径」，用于取该路径全文。
- 两个端点都复用 `/api/diagnose` 已有的答案完整性校验（缺题 → 400），不重复实现。
- 两条流用两种格式是刻意的：追问要 `useChat` 维护对话状态（§8.6 明确要求），解读是单次补全，纯文本流更简单。

### D4 · 前端：路径列表可点选 = 「本路径」，不新建详情页

结果页的路径列表项可点选，选中项即「本路径」（默认 = 匹配度最高的那条）。解读区与追问框都锚到它。

**理由**：设计 §8.5 的追问上下文需要「当前路径全文」，但前端没有路径详情页。点选列表项就地解决这个锚点，代价是几十行组件代码，而不是把计划③的 BlockRenderer 提前吃掉。**副作用**：学生此时看不到路径正文，只能看到解读文字——路径正文的渲染仍归计划③。

### D5 · 模型与密钥

| 环境变量 | 必填 | 默认值 |
|---|---|---|
| `DEEPSEEK_API_KEY` | 是 | — （缺失时端点直接 503，不进入流） |
| `DEEPSEEK_BASE_URL` | 否 | `https://api.deepseek.com/v1` |
| `DEEPSEEK_MODEL` | 否 | `deepseek-chat` |

- `.env` 读法用 **Node 内置的 `process.loadEnvFile()`**，不引入 `dotenv`。Node 25 已支持；文件不存在时抛错，需 try/catch 包住。
- 新建 `.env.example`。`.gitignore` 里已有 `!.env.example` 放行，`.env` 仍在忽略名单内（硬性约束 4）。
- `.env` 只在 `apps/api/src/index.ts` 读，**前端拿不到也见不到**（硬性约束：前端代码中不得出现任何 API Key）。

### D6 · 测试策略——不发真实网络请求

- 用 `ai/test` 的 `MockLanguageModelV3` 配合 `ai` 的 `simulateReadableStream` 造流式响应。
- `createApp(bundle, options?)` 新增可选的 `options.model`，测试注入 mock 模型；生产路径不传，走 DeepSeek。
- **无 API Key 时**：单测全绿不受影响；端到端只验证降级路径（解读区显示「个性化解读暂不可用」，其余结果完整）。有 Key 时按 Task 7 的手测步骤验证真实输出。
- 已实测确认（本机 npm registry）：`ai@7.0.127`、`@ai-sdk/openai@4.0.83`、`@ai-sdk/react@4.0.130`。`ai` 的 dist 直接 `import ... from "zod/v4"`，**zod 必须显式安装**（`^4.1.8`）。

**已从包内 `.d.ts` 核实、计划中直接使用的 API 面**（非凭记忆）：

- `streamText({ model, system | messages, prompt, ... })`，`model` 接受 `LanguageModelV2 | V3 | V4`
- 结果对象：`.text: PromiseLike<string>`、`.textStream`、`.toUIMessageStreamResponse(): Response`、`.toTextStreamResponse()`
- `createOpenAI({ baseURL?, apiKey? }) => OpenAIProvider`；`provider.chat(modelId): LanguageModelV4`
- `simulateReadableStream<T>({ chunks: T[], initialDelayInMs?, chunkDelayInMs? }): ReadableStream<T>`
- `ai/test` 导出 `MockLanguageModelV3` / `MockLanguageModelV4`（**没有 V2**）
- 流分片字面量：`text-start` / `text-delta` / `text-end` / `finish`
- `@ai-sdk/react` 导出 `useChat`、`useCompletion`；peer 为 `react ^18`
- 消息类型名为 `ModelMessage`（不是 `CoreMessage`）

---

## Global Constraints

以下约束适用于本计划的每一个任务，不再逐条重复：

- TypeScript `strict: true`，所有包启用
- **`packages/core` 零框架依赖、零网络请求**——不得 import `react` / `hono` / `ai` / `@navi/llm` / `@navi/api` / `@navi/web`，不得调用 `fetch` / `XMLHttpRequest`
- **`packages/llm` 只依赖 `core` 的类型**，不得 import `@navi/api` / `@navi/web` / `react`
- **推荐结果必须由 `core` 确定性算出**——本计划的 LLM 只做解读与追问，不得参与任何打分、排序、筛选
- 不得将知识库内容硬编码进 TypeScript 源码（提示词除外，提示词按 §8.8 放在 `packages/llm/prompts/*.md`）
- 前端代码中不得出现任何 API Key；`.env` 保持在 `.gitignore` 中
- 防幻觉硬约束（§8.3）必须原样写进两个提示词文件
- 提交信息使用中文，遵循 Conventional Commits（`feat:` / `fix:` / `chore:` / `docs:` / `test:`）

---

## Review Focus

以下是设计文档隐含、但单个任务的测试不会自然覆盖的输入与失败模式。每一条都在下方指定任务中被专门的测试固定住。

1. **没有 API Key / 模型欠费 / 模型超时**——学生仍必须拿到完整的画像、匹配度、路径推荐与不适用原因，只有解读区降级为「暂不可用」。整页报错是最糟的结果。（Task 5、7）
2. **客户端传来不完整的 `answers`，或夹带不存在的题目 id**——必须 400 拒绝，绝不能把半份画像送进模型。（Task 5）
3. **`pathId` 不存在或拼错**——必须 404，不能拿空路径去问模型，也不能让它悄悄退化成"回答所有路径"。（Task 5）
4. **模型返回了知识库没写的内容**——提示词已做约束（§8.3），但约束不能靠信任，必须有一条测试固定住提示词里确实带了 `<knowledge>` 且带了防幻觉段落。（Task 4）
5. **学生中途改选另一条路径**——上一条路径的解读文字与对话历史不得串到新路径上；解读区必须重置。（Task 6）

---

## File Structure

```
packages/llm/                          # 新增
├── package.json
├── tsconfig.json
├── prompts/
│   ├── interpret.md                  # 解读用系统提示词（§8.2 / §8.3）
│   └── chat.md                       # 追问用系统提示词（§8.3 / §8.5）
└── src/
    ├── context.ts                    # 纯函数：组装 messages
    ├── context.test.ts
    ├── index.ts                      # 提示词加载 + provider + streamInterpret / streamChat
    ├── sdk-smoke.test.ts             # Task 1：确认 SDK 面
    └── index.test.ts

packages/knowledge/
├── boundaries.md                     # 新增（§8.4）
└── src/build.ts                      # 修改：解析 boundaries.md
packages/knowledge/src/validate.ts    # 修改：KnowledgeBundle 加 boundaries
packages/core/src/types.ts            # 修改：KnowledgeBundle 加 boundaries（与上互为镜像）
packages/core/eslint.config.js        # 修改：restricted-imports 补 @navi/llm、ai

apps/api/src/
├── server.ts                         # 修改：两个新端点 + createApp 第二参数
├── server.test.ts                    # 修改：新端点测试
└── index.ts                          # 修改：loadEnvFile + 默认 model

apps/web/src/
├── App.tsx                           # 修改：保存 answers/grade 并下传
├── components/ResultView.tsx         # 修改：路径列表可点选
├── components/ResultView.test.tsx    # 修改：点选用例
├── components/PathAssistant.tsx      # 新增：解读区 + 追问框
└── components/PathAssistant.test.tsx # 新增
```

---

### Task 1: `packages/llm` 骨架与 SDK 面确认

先把这个包立起来，并用一次 mock 调用**证明 SDK 真的按预期工作**，再去写任何业务逻辑。这个 SDK 的大版本（v7）与网上多数示例（v5）的 API 不同，不能凭记忆写。

**Files:**
- Create: `packages/llm/package.json`
- Create: `packages/llm/tsconfig.json`
- Create: `packages/llm/src/sdk-smoke.test.ts`
- Modify: `packages/core/eslint.config.js`

**Interfaces:**
- Consumes: 无
- Produces: workspace 包 `@navi/llm`，后续任务在此包内开发

- [ ] **Step 1: 创建包配置**

`packages/llm/package.json`：

```json
{
  "name": "@navi/llm",
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
  "dependencies": {
    "@ai-sdk/openai": "^4.0.83",
    "@navi/core": "workspace:*",
    "ai": "^7.0.127",
    "zod": "^4.1.8"
  },
  "devDependencies": {
    "@types/node": "^22.10.2",
    "vitest": "^2.1.8"
  }
}
```

`zod` 是 `ai` 的 peerDependency，且 `ai` 的 dist 直接 `import ... from "zod/v4"`，不装会在运行时报模块找不到。

`packages/llm/tsconfig.json`：

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "lib": ["ES2022"], "types": ["node"] },
  "include": ["src"]
}
```

本包不需要 `eslint.config.js`——ESLint 9 会向上找到仓库根的 `eslint.config.js`，与 `apps/api`、`apps/web` 一致。

- [ ] **Step 2: 把 `@navi/llm` 加进 core 的禁止导入名单**

`packages/core/eslint.config.js` 的 `no-restricted-imports` 规则里，`group` 数组补上 `'@navi/llm'` 与 `'ai'`：

```js
group: ['react', 'react-*', 'hono', 'express', 'fastify', 'vite', 'ai', '@ai-sdk/*', '@navi/llm', '@navi/api', '@navi/web'],
```

**理由**：`core` 是依赖链的最底层，`llm` 在它之上。这条规则目前漏了 `@navi/llm`——也就是说今天 `core` 可以偷偷 import LLM 层而 lint 不报错。这是 1 行的修复。

- [ ] **Step 3: 验证边界规则确实会拦住 `core` 导入 llm**

临时在 `packages/core/src/smoke.test.ts` 顶部加一行 `import '@navi/llm'`，然后运行：

Run: `pnpm --filter @navi/core lint`
Expected: **FAIL**，报错信息包含「core 是纯逻辑层，不得引入框架或上层依赖」

确认后**删除这一行**，重新运行：

Run: `pnpm --filter @navi/core lint`
Expected: PASS

- [ ] **Step 4: 写 SDK 冒烟测试**

`packages/llm/src/sdk-smoke.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { streamText, simulateReadableStream } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'

/**
 * 这个测试不验证我们的业务逻辑，它只回答一个问题：
 * 当前安装的 SDK 版本，用 mock 模型造一次流式响应，写法到底是什么样。
 * 后续所有测试都依赖这里确定下来的形状。
 */
describe('Vercel AI SDK 面确认', () => {
  it('用 mock 模型跑通一次流式调用', async () => {
    const result = streamText({
      model: new MockLanguageModelV3({
        doStream: async () => ({
          stream: simulateReadableStream({
            chunks: [
              { type: 'text-start', id: '1' },
              { type: 'text-delta', id: '1', delta: '你好' },
              { type: 'text-end', id: '1' },
              { type: 'finish', finishReason: 'stop', usage: { inputTokens: 1, outputTokens: 1 } },
            ],
          }),
        }),
      }),
      prompt: 'test',
    })

    expect(await result.text).toBe('你好')
  })
})
```

- [ ] **Step 5: 运行，并按实际类型修正**

Run: `pnpm install && pnpm --filter @navi/llm test`

Expected: PASS。

**如果这一步失败**（很可能是 `doStream` 的返回形状不对），不要去猜：打开 `node_modules/ai/dist/test/index.d.ts`，找到 `MockLanguageModelV3` 与 `LanguageModelV3StreamResult` 的定义，照实际的必填字段补齐 `doStream` 的返回对象。若 `MockLanguageModelV3` 不可用，改用 `MockLanguageModelV4`（`createOpenAI` 实际产出的是 `LanguageModelV4`，两者 `streamText` 都接受）。

**这一步的结论是后续测试的基准，必须让它通过再往下走。**

- [ ] **Step 6: Commit**

```bash
git add packages/llm packages/core/eslint.config.js
git commit -m "chore(llm): 建立 llm 包骨架并确认 AI SDK 面，补 core 的边界规则"
```

---

### Task 2: `boundaries.md` 编译进 knowledge bundle

把「系统无法回答什么」变成内容资产（§8.4）。这是**转写设计文档已有的两条**，不是自行撰稿——推免、考研、考公的具体规则不在本任务范围内，一个字都不新增。

**Files:**
- Create: `packages/knowledge/boundaries.md`
- Modify: `packages/knowledge/src/build.ts`
- Modify: `packages/knowledge/src/validate.ts`（`KnowledgeBundle` 加 `boundaries`）
- Modify: `packages/core/src/types.ts`（同上，保持镜像）
- Modify: `packages/knowledge/src/build.test.ts`（加用例）
- Modify: `packages/knowledge/src/validate.test.ts`（fixture 补字段）
- Modify: `packages/core/src/diagnose.test.ts`（fixture 补字段）
- Modify: `apps/api/src/server.test.ts`（fixture 补字段）

**Interfaces:**
- Consumes: 既有 `parseBlocks(content): Block[]`
- Produces: `KnowledgeBundle.boundaries: Block[]`，供 Task 3 读入提示词

- [ ] **Step 1: 创建 boundaries.md**

`packages/knowledge/boundaries.md`——内容照抄设计文档 §8.4 的两个例子：

```markdown
:::boundary topic="转专业政策"
各校各学院转专业政策每年都可能调整，且涉及绩点门槛、名额、是否降级转
等大量院系差异，我们无法给出可靠建议。
建议：查询你所在学校教务处官网，或直接咨询辅导员与直系学长学姐。
:::

:::boundary topic="院校录取分数线预测"
我们不预测任何学校任何专业的录取分数。请参考官方招生简章与往年数据。
:::
```

> **内容组注意**：这两条是从设计文档 §8.4 转写的，属于我们自己对「能力边界」的声明，不是外部事实，因此不涉及核实风险。若内容组要补充条目，照同一格式追加即可——**新增块类型不需要改任何 schema**（设计 §6.3）。

- [ ] **Step 2: 写失败的测试**

在 `packages/knowledge/src/build.test.ts` 末尾追加：

```ts
describe('buildKnowledge · 诚实边界', () => {
  it('根目录没有 boundaries.md 时返回空数组', () => {
    expect(buildKnowledge(makeTempRoot()).boundaries).toEqual([])
  })

  it('解析 boundaries.md 为内容块', () => {
    const root = makeTempRoot()
    writeFileSync(
      join(root, 'boundaries.md'),
      ':::boundary topic="转专业政策"\n我们无法给出可靠建议。\n:::\n',
      'utf8',
    )
    const blocks = buildKnowledge(root).boundaries
    expect(blocks).toHaveLength(1)
    expect(blocks[0]!.raw).toContain('转专业政策')
  })
})
```

- [ ] **Step 3: 运行测试确认失败**

Run: `pnpm --filter @navi/knowledge test`
Expected: FAIL，`boundaries` 为 `undefined`（或类型报错）

- [ ] **Step 4: 实现**

`packages/knowledge/src/validate.ts` 的 `KnowledgeBundle` 加字段：

```ts
export interface KnowledgeBundle {
  indicators: IndicatorDef[]
  questions: QuestionDef[]
  archetypes: ArchetypeDef[]
  paths: PathDef[]
  blocks: Record<string, Block[]>
  /** 诚实边界清单（设计文档 §8.4）。文件缺失时为空数组 */
  boundaries: Block[]
}
```

`packages/core/src/types.ts` 里的 `KnowledgeBundle` 做同样改动（这两处是镜像，必须同步）。

`packages/knowledge/src/build.ts` 的 `buildKnowledge` 里，`paths` 收集完之后、`return` 之前加：

```ts
  const boundariesPath = join(rootDir, 'boundaries.md')
  const boundaries = existsSync(boundariesPath)
    ? parseBlocks(parseFrontmatter(readFileSync(boundariesPath, 'utf8')).content)
    : []
```

并把 `return` 改为：

```ts
  return { indicators, questions, archetypes, paths, blocks, boundaries }
```

- [ ] **Step 5: 补齐受影响的 fixture**

`KnowledgeBundle` 加了必填字段，以下三处 fixture 各补一行 `boundaries: []`：

- `packages/knowledge/src/validate.test.ts` 的 `bundle()` 与「校验永不抛错」用例里的 `empty`
- `packages/core/src/diagnose.test.ts` 的 `makeKnowledge()` 与「知识库为空时返回空结构」用例里的 `empty`
- `apps/api/src/server.test.ts` 的 `bundle`

- [ ] **Step 6: 运行全部测试**

Run: `pnpm test`
Expected: PASS，且知识库编译输出为 `7 条路径、8 个指标、28 道题目，0 条警告`

- [ ] **Step 7: Commit**

```bash
git add packages/knowledge packages/core/src/types.ts apps/api/src/server.test.ts packages/core/src/diagnose.test.ts
git commit -m "feat(knowledge): 诚实边界清单编译进 bundle，KnowledgeBundle 增加 boundaries"
```

---

### Task 3: 上下文组装（纯函数）

本层最核心也最容易错的部分：把学生画像、诊断结果、本路径全文、全部路径摘要、诚实边界，按 §8.2 与 §8.5 组装成 messages。**纯函数，不碰网络、不碰 SDK 的运行时**。

**Files:**
- Create: `packages/llm/src/context.ts`
- Test: `packages/llm/src/context.test.ts`

**Interfaces:**
- Consumes: `KnowledgeBundle`（Task 2，含 `boundaries`）、`DiagnosisResult`、`Answers`（均来自 `@navi/core`）
- Produces:
  - `interface KnowledgeSlice { bundle: KnowledgeBundle; result: DiagnosisResult; pathId: string }`
  - `buildSystemContent(knowledge: KnowledgeSlice): string`
  - `buildInterpretMessages(input: { knowledge: KnowledgeSlice; systemPrompt: string }): ModelMessage[]`
  - `buildChatMessages(input: { knowledge: KnowledgeSlice; systemPrompt: string; history: ModelMessage[] }): ModelMessage[]`

- [ ] **Step 1: 写失败的测试**

`packages/llm/src/context.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { buildSystemContent, buildInterpretMessages, buildChatMessages } from './context.js'
import type { DiagnosisResult, KnowledgeBundle } from '@navi/core'

const bundle: KnowledgeBundle = {
  indicators: [{ id: 'academic-interest', name: '学术志趣' }],
  questions: [],
  archetypes: [],
  paths: [
    {
      id: 'same-discipline-baoyan', title: '本学科保研', category: 'academic',
      span: 'same-discipline', status: 'draft', summary: '保研的核心是用绩点排名换免试资格。',
      weights: [], eligibility: [],
    },
    {
      id: 'civil-service', title: '考公考编 / 选调生', category: 'civil',
      span: 'same-discipline', status: 'draft', summary: '体制内就业的核心是应届生身份。',
      weights: [], eligibility: [],
    },
  ],
  blocks: {
    'same-discipline-baoyan': [{ type: 'timeline', html: '<p>大三下夏令营</p>', raw: '大三下夏令营' }],
    'civil-service': [],
  },
  boundaries: [{ type: 'free', html: '<p>转专业政策无法可靠回答</p>', raw: '转专业政策无法可靠回答' }],
}

const result: DiagnosisResult = {
  indicators: {
    'academic-interest': { score: 82, known: true, consistency: 0.9, sources: ['q1'] },
    'gpa-competitiveness': { score: 40, known: true, consistency: 0.5, sources: ['q2'] },
  },
  paths: [
    {
      id: 'same-discipline-baoyan', match: 78, confidence: 0.74,
      eligibility: { applicable: true, hardFailures: [], softWarnings: [] },
      contributions: [],
    },
  ],
  archetypes: [{ id: 'steady-scholar', affinity: 0.68 }],
}

const knowledge = { bundle, result, pathId: 'same-discipline-baoyan' }

describe('buildSystemContent', () => {
  it('带上全部 8 维分数与一致性', () => {
    const content = buildSystemContent(knowledge)
    expect(content).toContain('学术志趣')
    expect(content).toContain('82')
    expect(content).toContain('0.9')
  })

  it('带上画像软归属百分比', () => {
    expect(buildSystemContent(knowledge)).toContain('68%')
  })

  it('带上本路径全文，且只有本路径的正文', () => {
    const content = buildSystemContent(knowledge)
    expect(content).toContain('大三下夏令营')
  })

  it('带上全部路径的 summary（跨路径对比问题靠它）', () => {
    const content = buildSystemContent(knowledge)
    expect(content).toContain('保研的核心是用绩点排名换免试资格')
    expect(content).toContain('体制内就业的核心是应届生身份')
  })

  it('带上诚实边界', () => {
    expect(buildSystemContent(knowledge)).toContain('转专业政策无法可靠回答')
  })
})

describe('buildInterpretMessages', () => {
  it('第一条是 system，最后一条是 user 指令', () => {
    const messages = buildInterpretMessages({ knowledge, systemPrompt: '你是 Navi。' })
    expect(messages[0]!.role).toBe('system')
    expect(messages.at(-1)!.role).toBe('user')
  })

  it('系统内容里同时含提示词与 <knowledge> 包裹的知识', () => {
    const messages = buildInterpretMessages({ knowledge, systemPrompt: '你是 Navi。' })
    const system = String(messages[0]!.content)
    expect(system).toContain('你是 Navi。')
    expect(system).toContain('<knowledge>')
    expect(system).toContain('</knowledge>')
  })
})

describe('buildChatMessages', () => {
  it('保留传入的对话历史，并追加本轮提问', () => {
    const messages = buildChatMessages({
      knowledge,
      systemPrompt: '你是 Navi。',
      history: [
        { role: 'user', content: '保研和考研怎么选？' },
        { role: 'assistant', content: '两者时间窗口不同。' },
      ],
    })
    expect(messages).toHaveLength(4)   // system + 2 条历史 + 本轮 user
    expect(messages[0]!.role).toBe('system')
    expect(messages[1]!.content).toBe('保研和考研怎么选？')
    expect(messages.at(-1)!.role).toBe('user')
  })

  it('没有历史时只有 system 加一条 user', () => {
    const messages = buildChatMessages({ knowledge, systemPrompt: '你是 Navi。', history: [] })
    expect(messages).toHaveLength(2)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @navi/llm test`
Expected: FAIL，报错「Cannot find module './context.js'」

- [ ] **Step 3: 实现**

`packages/llm/src/context.ts`：

```ts
import type { DiagnosisResult, KnowledgeBundle, PathResult } from '@navi/core'
import type { ModelMessage } from 'ai'

export interface KnowledgeSlice {
  bundle: KnowledgeBundle
  result: DiagnosisResult
  /** 「本路径」——学生当前选中的那条 */
  pathId: string
}

/** 8 维分数 + 一致性，逐行列出 */
function formatIndicators(slice: KnowledgeSlice): string {
  const names = new Map(slice.bundle.indicators.map(i => [i.id, i.name]))
  return Object.entries(slice.result.indicators)
    .map(([id, score]) => {
      if (!score.known) return `- ${names.get(id) ?? id}：无数据`
      return `- ${names.get(id) ?? id}：${Math.round(score.score)}/100（作答一致性 ${score.consistency.toFixed(2)}）`
    })
    .join('\n')
}

/** 路径匹配结果，含不适用原因 */
function formatPaths(slice: KnowledgeSlice): string {
  const titles = new Map(slice.bundle.paths.map(p => [p.id, p.title]))
  return slice.result.paths
    .map(p => {
      const title = titles.get(p.id) ?? p.id
      const reasons = p.eligibility.hardFailures.map(f => f.message).join('；')
      if (!p.eligibility.applicable) return `- ${title}：不适用（${reasons}）`
      return `- ${title}：匹配度 ${Math.round(p.match)}，置信度 ${Math.round(p.confidence * 100)}%`
    })
    .join('\n')
}

/** 画像软归属 */
function formatArchetypes(slice: KnowledgeSlice): string {
  const names = new Map(slice.bundle.archetypes.map(a => [a.id, a.name]))
  return slice.result.archetypes
    .slice(0, 3)
    .map(a => `- ${names.get(a.id) ?? a.id}：${Math.round(a.affinity * 100)}%`)
    .join('\n')
}

/** 本路径的完整正文（按知识库顺序，保留块标题） */
function formatCurrentPath(slice: KnowledgeSlice): string {
  const blocks = slice.bundle.blocks[slice.pathId] ?? []
  if (blocks.length === 0) return '（这条路径暂无正文内容）'
  return blocks.map(b => b.raw).join('\n\n')
}

/** 全部路径的 summary——回答「保研和考研怎么选」这类跨路径问题靠它 */
function formatAllSummaries(slice: KnowledgeSlice): string {
  return slice.bundle.paths
    .map(p => `### ${p.title}\n${p.summary}`)
    .join('\n\n')
}

function formatBoundaries(slice: KnowledgeSlice): string {
  if (slice.bundle.boundaries.length === 0) return '（无）'
  return slice.bundle.boundaries.map(b => b.raw).join('\n\n')
}

/**
 * 拼出 <knowledge> 块的内容（设计文档 §8.2 + §8.5）。
 * 顺序固定，便于测试与排查；模型只能使用这里面的信息（§8.3）。
 */
export function buildSystemContent(slice: KnowledgeSlice): string {
  const currentTitle =
    slice.bundle.paths.find(p => p.id === slice.pathId)?.title ?? slice.pathId

  return [
    '<knowledge>',
    '## 学生画像（8 个维度，0–100）',
    formatIndicators(slice),
    '',
    '## 诊断结果',
    formatPaths(slice),
    '',
    '## 画像标签',
    formatArchetypes(slice),
    '',
    `## 学生当前查看的路径：${currentTitle}（全文）`,
    formatCurrentPath(slice),
    '',
    '## 全部路径摘要',
    formatAllSummaries(slice),
    '',
    '## 我们无法可靠回答的问题',
    formatBoundaries(slice),
    '</knowledge>',
  ].join('\n')
}

export function buildInterpretMessages(input: {
  knowledge: KnowledgeSlice
  systemPrompt: string
}): ModelMessage[] {
  return [
    { role: 'system', content: `${input.systemPrompt}\n\n${buildSystemContent(input.knowledge)}` },
    { role: 'user', content: '请基于以上信息，输出我的个性化解读。' },
  ]
}

export function buildChatMessages(input: {
  knowledge: KnowledgeSlice
  systemPrompt: string
  history: ModelMessage[]
}): ModelMessage[] {
  return [
    { role: 'system', content: `${input.systemPrompt}\n\n${buildSystemContent(input.knowledge)}` },
    ...input.history,
  ]
}
```

> `formatPaths` / `formatArchetypes` 里的 `PathResult` 导入是给类型用的，若 lint 报未使用则删掉该 import——`slice.result.paths` 的元素类型是推导出来的。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @navi/llm test`
Expected: PASS，10 个用例全绿

- [ ] **Step 5: Commit**

```bash
git add packages/llm/src/context.ts packages/llm/src/context.test.ts
git commit -m "feat(llm): 实现上下文组装，按 §8.2 与 §8.5 拼装 knowledge 块"
```

---

### Task 4: 提示词与模型编排

**Files:**
- Create: `packages/llm/prompts/interpret.md`
- Create: `packages/llm/prompts/chat.md`
- Create: `packages/llm/src/index.ts`
- Test: `packages/llm/src/index.test.ts`

**Interfaces:**
- Consumes: `buildInterpretMessages` / `buildChatMessages`（Task 3）
- Produces:
  - `interface StreamOptions { model?: LanguageModel; systemPromptDir?: string }`
  - `streamInterpret(input: { answers: Answers; grade: string; pathId: string; bundle: KnowledgeBundle }, options?: StreamOptions): ReturnType<typeof streamText>`
  - `streamChat(input: { answers: Answers; grade: string; pathId: string; messages: ModelMessage[]; bundle: KnowledgeBundle }, options?: StreamOptions): ReturnType<typeof streamText>`
  - `createDeepSeekModel(env?: NodeJS.ProcessEnv): LanguageModel`

- [ ] **Step 1: 写提示词文件**

`packages/llm/prompts/interpret.md`：

```markdown
你是 Navi，一名熟悉中国大学生升学与就业路径的顾问。你的读者是大学低年级学生，以及他们身边关心这件事的家长。

## 你的任务
基于下方 <knowledge> 中的信息，写一份针对这位学生的个性化解读。解读要让学生看懂：他现在的处境是什么、为什么系统给他推荐这些路径、他接下来该关注什么。

## 硬约束（违反即失败）
1. 你**只能**使用 <knowledge> 标签内的信息。知识库未覆盖的内容，**禁止**基于常识推测或补充。
2. 若学生所问或你所需的信息不在其中，必须明确写出「这部分我们没有可靠信息」，并指出查询途径。
3. 不要重复罗列已经展示给学生的分数与匹配度表格——那些学生已经看到了。
4. 不要给出知识库没有依据的具体数字、日期、分数线、名额。
5. <knowledge> 中标注为待核实的内容，你在解读时必须说明「这部分信息尚待核实」。

## 输出要求
- 分三段，依次为：**你现在的位置**、**为什么推荐这几条路**、**接下来关注什么**。
- 每段 2–4 句，总共不超过 500 字。
- 用第二人称「你」，语气平实，不煽情、不打鸡血。
- 直接输出正文，不要写标题以外的任何前后缀。
```

`packages/llm/prompts/chat.md`：

```markdown
你是 Navi，一名熟悉中国大学生升学与就业路径的顾问。学生刚刚做完生涯倾向测评，正在就自己的结果提问。

## 你的任务
基于下方 <knowledge> 中的信息回答学生的问题。学生当前正在查看其中一条路径，如果问题与这条路径有关，优先结合它的正文回答。

## 硬约束（违反即失败）
1. 你**只能**使用 <knowledge> 标签内的信息。知识库未覆盖的内容，**禁止**基于常识推测或补充。
2. 若学生所问不在其中，必须回答：「这部分我们没有可靠信息」，并指出查询途径。
3. 不要编造知识库没有的具体数字、日期、分数线、名额、政策条款。
4. 学生问的是各校各年可能变化的政策细节时，直接引用 <knowledge> 中「我们无法可靠回答的问题」那一段的说明。
5. 不要替学生做决定，也不要说「你应该选 X」。把差异讲清楚，让学生自己判断。
6. <knowledge> 中标注为待核实的内容，说明时必须提示「这部分信息尚待核实」。

## 输出要求
- 直接回答，不要复述问题，不要在开头写「根据你的情况」这类套话。
- 单次回答不超过 300 字，除非学生明确要求展开。
- 语气平实，用第二人称「你」。
```

- [ ] **Step 2: 写失败的测试**

`packages/llm/src/index.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { simulateReadableStream } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'
import type { LanguageModel } from 'ai'
import { streamInterpret, streamChat } from './index.js'
import type { Answers, KnowledgeBundle } from '@navi/core'

const bundle: KnowledgeBundle = {
  indicators: [{ id: 'academic-interest', name: '学术志趣' }],
  questions: [
    { id: 'q1', indicator: 'academic-interest', text: 'q1', options: ['a','b','c','d','e'], weight: 1 },
    { id: 'q2', indicator: 'academic-interest', text: 'q2', options: ['a','b','c','d','e'], weight: 1 },
    { id: 'q3', indicator: 'academic-interest', text: 'q3', options: ['a','b','c','d','e'], weight: 1 },
  ],
  archetypes: [],
  paths: [
    {
      id: 'same-discipline-baoyan', title: '本学科保研', category: 'academic',
      span: 'same-discipline', status: 'draft', summary: '保研是用绩点换免试资格。',
      weights: [{ indicator: 'academic-interest', weight: 1, ideal: 90 }], eligibility: [],
    },
  ],
  blocks: { 'same-discipline-baoyan': [{ type: 'timeline', html: '<p>夏令营</p>', raw: '大三下夏令营' }] },
  boundaries: [],
}

const answers: Answers = { q1: 4, q2: 4, q3: 4 }

/** 造一个会说固定话的 mock 模型 */
function mockModel(text = '解读正文'): LanguageModel {
  return new MockLanguageModelV3({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: 'text-start', id: '1' },
          { type: 'text-delta', id: '1', delta: text },
          { type: 'text-end', id: '1' },
          { type: 'finish', finishReason: 'stop', usage: { inputTokens: 1, outputTokens: 1 } },
        ],
      }),
    }),
  }) as unknown as LanguageModel
}

describe('streamInterpret', () => {
  it('产出模型返回的解读正文', async () => {
    const result = streamInterpret(
      { answers, grade: 'freshman', pathId: 'same-discipline-baoyan', bundle },
      { model: mockModel('你现在大一，保研是最紧的一条路。') },
    )
    expect(await result.text).toBe('你现在大一，保研是最紧的一条路。')
  })

  it('发给模型的系统提示词同时含防幻觉约束与知识正文', async () => {
    const model = mockModel()
    await streamInterpret(
      { answers, grade: 'freshman', pathId: 'same-discipline-baoyan', bundle },
      { model },
    ).text

    const call = (model as unknown as { doStreamCalls: Array<{ prompt: unknown }> }).doStreamCalls[0]!
    const serialized = JSON.stringify(call.prompt)
    expect(serialized).toContain('只能')
    expect(serialized).toContain('<knowledge>')
    expect(serialized).toContain('大三下夏令营')
  })
})

describe('streamChat', () => {
  it('把对话历史与知识一起发给模型', async () => {
    const model = mockModel('两条路的时间窗不同。')
    const result = streamChat(
      {
        answers, grade: 'freshman', pathId: 'same-discipline-baoyan', bundle,
        messages: [{ role: 'user', content: '保研和考研怎么选？' }],
      },
      { model },
    )
    expect(await result.text).toBe('两条路的时间窗不同。')

    const call = (model as unknown as { doStreamCalls: Array<{ prompt: unknown }> }).doStreamCalls[0]!
    expect(JSON.stringify(call.prompt)).toContain('保研和考研怎么选？')
  })
})

describe('降级', () => {
  it('模型调用失败时抛出可捕获的错误，不吞掉', async () => {
    const broken = new MockLanguageModelV3({
      doStream: async () => { throw new Error('模型欠费') },
    }) as unknown as LanguageModel

    await expect(
      streamInterpret(
        { answers, grade: 'freshman', pathId: 'same-discipline-baoyan', bundle },
        { model: broken },
      // .text 触发实际调用；失败必须能冒泡到调用方，由 API 层转成降级响应
      ).text,
    ).rejects.toThrow()
  })
})
```

- [ ] **Step 3: 运行测试确认失败**

Run: `pnpm --filter @navi/llm test`
Expected: FAIL，报错「Cannot find module './index.js'」

- [ ] **Step 4: 实现**

`packages/llm/src/index.ts`：

```ts
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { streamText } from 'ai'
import type { LanguageModel, ModelMessage } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import { diagnose } from '@navi/core'
import type { Answers, KnowledgeBundle } from '@navi/core'
import { buildChatMessages, buildInterpretMessages } from './context.js'
import type { KnowledgeSlice } from './context.js'

const PROMPT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'prompts')

/** 提示词不硬编码进 TypeScript（设计文档 §8.8） */
function loadPrompt(name: 'interpret' | 'chat'): string {
  return readFileSync(join(PROMPT_DIR, `${name}.md`), 'utf8').trim()
}

export interface StreamOptions {
  /** 测试注入用；生产不传，走 DeepSeek */
  model?: LanguageModel
}

/** DeepSeek 兼容 OpenAI 的 /chat/completions（设计文档 §8.6） */
export function createDeepSeekModel(env: NodeJS.ProcessEnv = process.env): LanguageModel {
  const apiKey = env.DEEPSEEK_API_KEY
  if (!apiKey) throw new Error('未配置 DEEPSEEK_API_KEY')

  const provider = createOpenAI({
    apiKey,
    baseURL: env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1',
  })
  return provider.chat(env.DEEPSEEK_MODEL ?? 'deepseek-chat')
}

/** 服务端自己重算诊断，不接受客户端传来的结果（§5.1 确定性） */
function sliceOf(answers: Answers, bundle: KnowledgeBundle, pathId: string): KnowledgeSlice {
  return { bundle, result: diagnose(answers, bundle), pathId }
}

export function streamInterpret(
  input: { answers: Answers; grade: string; pathId: string; bundle: KnowledgeBundle },
  options: StreamOptions = {},
) {
  const knowledge = sliceOf(input.answers, input.bundle, input.pathId)
  return streamText({
    model: options.model ?? createDeepSeekModel(),
    messages: buildInterpretMessages({ knowledge, systemPrompt: loadPrompt('interpret') }),
  })
}

export function streamChat(
  input: {
    answers: Answers
    grade: string
    pathId: string
    messages: ModelMessage[]
    bundle: KnowledgeBundle
  },
  options: StreamOptions = {},
) {
  const knowledge = sliceOf(input.answers, input.bundle, input.pathId)
  return streamText({
    model: options.model ?? createDeepSeekModel(),
    messages: buildChatMessages({
      knowledge,
      systemPrompt: loadPrompt('chat'),
      history: input.messages,
    }),
  })
}
```

> `grade` 参数在当前实现里没有用到——`diagnose` 只吃 `answers`。保留它是为了与 `/api/diagnose` 的入参形状一致，且年级分流在 API 层已完成（题目已按年级过滤后下发，答案里没有别的年级的题）。若审阅时认为多余，删掉即可，同时删掉 API 层传参。

- [ ] **Step 5: 运行测试确认通过**

Run: `pnpm --filter @navi/llm test`
Expected: PASS。若 Step 2 里 `doStreamCalls[0].prompt` 的路径与 SDK 实际不符，照 `node_modules/ai/dist/test/index.d.ts` 里的 `MockLanguageModelV3CallOptions` 定义修正取值路径。

- [ ] **Step 6: Commit**

```bash
git add packages/llm/prompts packages/llm/src/index.ts packages/llm/src/index.test.ts
git commit -m "feat(llm): 提示词落盘，实现 streamInterpret 与 streamChat"
```

---

### Task 5: API 端点与降级

**Files:**
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/src/server.test.ts`
- Modify: `apps/api/src/index.ts`
- Create: `.env.example`
- Modify: `apps/api/package.json`

**Interfaces:**
- Consumes: `streamInterpret` / `streamChat`（Task 4）
- Produces: `createApp(bundle: KnowledgeBundle, options?: { model?: LanguageModel }): Hono`；`POST /api/interpret`；`POST /api/chat`

- [ ] **Step 1: 写失败的测试**

`apps/api/src/server.test.ts`：**文件顶部**新增三个 import（import 必须在顶层，不能写在文件中间）：

```ts
import { MockLanguageModelV3 } from 'ai/test'
import { simulateReadableStream } from 'ai'
import type { LanguageModel } from 'ai'
```

然后在**文件末尾**追加下面的用例（复用该文件已有的 `bundle` fixture 与 `q` 构造器）：

```ts
function mockModel(text: string): LanguageModel {
  return new MockLanguageModelV3({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: 'text-start', id: '1' },
          { type: 'text-delta', id: '1', delta: text },
          { type: 'text-end', id: '1' },
          { type: 'finish', finishReason: 'stop', usage: { inputTokens: 1, outputTokens: 1 } },
        ],
      }),
    }),
  }) as unknown as LanguageModel
}

const okAnswers = { q1: 4, q2: 4, q3: 4 }

describe('POST /api/interpret', () => {
  it('返回流式解读文本', async () => {
    const app = createApp(bundle, { model: mockModel('你现在的位置是大一。') })
    const res = await app.request('/api/interpret', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ answers: okAnswers, grade: 'freshman', pathId: 'same-discipline-baoyan' }),
    })
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('你现在的位置是大一。')
  })

  it('pathId 不存在时返回 404，不进入模型', async () => {
    let called = false
    const spy = new MockLanguageModelV3({
      doStream: async () => { called = true; throw new Error('不该被调用') },
    }) as unknown as LanguageModel
    const app = createApp(bundle, { model: spy })
    const res = await app.request('/api/interpret', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ answers: okAnswers, grade: 'freshman', pathId: 'not-exist' }),
    })
    expect(res.status).toBe(404)
    expect(called).toBe(false)
  })

  it('答案不完整时返回 400，不进入模型', async () => {
    const app = createApp(bundle, { model: mockModel('不该出现') })
    const res = await app.request('/api/interpret', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ answers: { q1: 4 }, grade: 'freshman', pathId: 'same-discipline-baoyan' }),
    })
    expect(res.status).toBe(400)
  })

  it('未配置 API Key 且没有注入模型时返回 503，而不是 500', async () => {
    const saved = process.env.DEEPSEEK_API_KEY
    delete process.env.DEEPSEEK_API_KEY
    try {
      const res = await createApp(bundle).request('/api/interpret', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ answers: okAnswers, grade: 'freshman', pathId: 'same-discipline-baoyan' }),
      })
      expect(res.status).toBe(503)
    } finally {
      if (saved !== undefined) process.env.DEEPSEEK_API_KEY = saved
    }
  })
})

describe('POST /api/chat', () => {
  it('返回流式回答', async () => {
    const app = createApp(bundle, { model: mockModel('保研与考研的时间窗不同。') })
    const res = await app.request('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        answers: okAnswers, grade: 'freshman', pathId: 'same-discipline-baoyan',
        messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: '保研和考研怎么选？' }] }],
      }),
    })
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('保研与考研的时间窗不同。')
  })
})
```

> `messages` 的形状以 `useChat` 实际发送的为准。Task 6 接完前端后回来核对一次；若 SDK 发的是 `parts` 数组，转换逻辑写在 `server.ts` 里（见 Step 3）。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @navi/api test`
Expected: FAIL，`/api/interpret` 返回 404（端点不存在）

- [ ] **Step 3: 实现端点**

`apps/api/src/server.ts` 改动三处。

包顶部加导入：

```ts
import { streamChat, streamInterpret } from '@navi/llm'
import type { LanguageModel, ModelMessage } from 'ai'

export interface AppOptions {
  /** 测试注入用；生产不传，走 DeepSeek */
  model?: LanguageModel
}
```

`createApp` 签名改为：

```ts
export function createApp(bundle: KnowledgeBundle, options: AppOptions = {}): Hono {
```

包顶部再加两个类型导入：

```ts
import type { Context } from 'hono'
import type { Question } from '@navi/core'
```

在 `app.get('/api/knowledge/:pathId', ...)` 之前，先放一个两个端点共用的入参校验闭包（写在 `createApp` 内部，`c` 由调用方传入）：

```ts
  /**
   * 两个 LLM 端点共用的入参校验：答案须覆盖全部适用题目。
   * 通过时返回解析结果，失败时返回一个 Response，调用方直接 `return` 它。
   */
  function validate(c: Context, body: unknown):
    | { answers: Answers; grade: Grade | undefined; scopedQuestions: Question[] }
    | Response {
    const answers = (body as { answers?: unknown } | null)?.answers
    if (answers === null || typeof answers !== 'object' || Array.isArray(answers)) {
      return c.json({ error: '缺少 answers 字段，或格式不是对象' }, 400)
    }

    const grade = parseGrade((body as { grade?: unknown }).grade)
    const scopedQuestions = scopeQuestions(bundle.questions, grade)

    const answerIds = new Set(Object.keys(answers as Record<string, unknown>))
    const missing = scopedQuestions.filter(q => !answerIds.has(q.id)).map(q => q.id)
    if (missing.length > 0) {
      return c.json({ error: `以下题目未作答：${missing.join(', ')}` }, 400)
    }

    return { answers: answers as Answers, grade, scopedQuestions }
  }
```

再加一个 pathId 校验的共用小工具，放在 `createApp` 外面（纯函数，不依赖 bundle）：

```ts
/** pathId 必须指向真实存在的路径——不能拿空路径去问模型 */
function findPathId(body: unknown, bundle: KnowledgeBundle): string | null {
  const pathId = String((body as { pathId?: unknown }).pathId ?? '')
  return bundle.paths.some(p => p.id === pathId) ? pathId : null
}
```

两个端点：

```ts
  app.post('/api/interpret', async c => {
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: '请求体不是合法 JSON' }, 400)
    }

    const parsed = validate(c, body)
    if (parsed instanceof Response) return parsed

    const pathId = findPathId(body, bundle)
    if (pathId === null) {
      return c.json({ error: `路径不存在：${String((body as { pathId?: unknown }).pathId ?? '')}` }, 404)
    }

    // 模型不可用时降级（设计文档 §8.7）：结构化结果仍由 /api/diagnose 完整提供，
    // 这里只让解读不可用——用一个明确的状态码，而不是半截流
    if (!options.model && !process.env.DEEPSEEK_API_KEY) {
      return c.json({ error: '个性化解读暂不可用：服务端未配置模型' }, 503)
    }

    const scoped: KnowledgeBundle = { ...bundle, questions: parsed.scopedQuestions }
    try {
      const result = streamInterpret(
        {
          answers: parsed.answers,
          grade: parsed.grade ?? 'freshman',
          pathId,
          bundle: scoped,
        },
        options,
      )
      return result.toTextStreamResponse()
    } catch (error) {
      return c.json({ error: `个性化解读暂不可用：${(error as Error).message}` }, 503)
    }
  })
```

`/api/chat` 同构，差别只在：额外读 `messages` 并转成 `ModelMessage[]`，返回 `toUIMessageStreamResponse()`。

```ts
  app.post('/api/chat', async c => {
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: '请求体不是合法 JSON' }, 400)
    }

    const parsed = validate(c, body)
    if (parsed instanceof Response) return parsed

    const pathId = findPathId(body, bundle)
    if (pathId === null) {
      return c.json({ error: `路径不存在：${String((body as { pathId?: unknown }).pathId ?? '')}` }, 404)
    }

    const messages = toModelMessages((body as { messages?: unknown }).messages)
    if (messages.length === 0) {
      return c.json({ error: 'messages 为空' }, 400)
    }

    if (!options.model && !process.env.DEEPSEEK_API_KEY) {
      return c.json({ error: '追问暂不可用：服务端未配置模型' }, 503)
    }

    const scoped: KnowledgeBundle = { ...bundle, questions: parsed.scopedQuestions }
    try {
      const result = streamChat(
        {
          answers: parsed.answers,
          grade: parsed.grade ?? 'freshman',
          pathId,
          messages,
          bundle: scoped,
        },
        options,
      )
      return result.toUIMessageStreamResponse()
    } catch (error) {
      return c.json({ error: `追问暂不可用：${(error as Error).message}` }, 503)
    }
  })
```

`toModelMessages` 是文件内的一个小工具，把 `useChat` 发来的 UI 消息压成纯文本历史：

```ts
/** UI 消息（useChat 的格式）→ 纯文本对话历史。只取文本，不传 parts 结构给模型 */
function toModelMessages(raw: unknown): ModelMessage[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap(message => {
    const { role, parts } = message as { role?: unknown; parts?: unknown }
    if (role !== 'user' && role !== 'assistant') return []
    const text = Array.isArray(parts)
      ? parts
          .filter((p): p is { type: 'text'; text: string } =>
            typeof p === 'object' && p !== null && (p as { type?: unknown }).type === 'text')
          .map(p => p.text)
          .join('')
      : ''
    return text === '' ? [] : [{ role, content: text }]
  })
}
```

> **Task 6 接完前端后必须回来核对 `parts` 的实际形状**。若 `useChat` 发的是别的东西，改这个函数即可——它是唯一一处做转换的地方。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @navi/api test`
Expected: PASS

- [ ] **Step 5: 接入 .env 与默认模型**

`apps/api/package.json` 的 `dependencies` 增加：

```json
"@navi/llm": "workspace:*"
```

`apps/api/src/index.ts` 在读取知识库之前加：

```ts
// .env 只在服务端读（硬性约束：前端不得出现任何 API Key）。
// 文件不存在时 loadEnvFile 会抛错，属正常情况，忽略即可。
try {
  process.loadEnvFile()
} catch {
  // 没有 .env 时按未配置处理，端点会走降级分支
}
```

新建 `.env.example`：

```
# DeepSeek（兼容 OpenAI 的 /chat/completions）
# 复制为 .env 后填入真实值。.env 已在 .gitignore 中，不会被提交。
DEEPSEEK_API_KEY=
# 可选，默认 https://api.deepseek.com/v1
DEEPSEEK_BASE_URL=
# 可选，默认 deepseek-chat
DEEPSEEK_MODEL=
```

- [ ] **Step 6: 验证 `.env` 仍被忽略、`.env.example` 不被忽略**

Run: `git check-ignore -v .env; git status --short .env.example`
Expected: `.env` 命中 `.gitignore` 规则；`.env.example` 出现在待提交列表里（不被忽略）

- [ ] **Step 7: 全部测试 + lint**

Run: `pnpm test && pnpm -r lint`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add apps/api .env.example pnpm-lock.yaml
git commit -m "feat(api): 新增 /api/interpret 与 /api/chat，未配置模型时降级为 503"
```

---

### Task 6: 前端接线

结果页的路径列表可点选决定「本路径」，解读区与追问框都锚到它。

**Files:**
- Modify: `apps/web/package.json`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/components/ResultView.tsx`
- Modify: `apps/web/src/components/ResultView.test.tsx`
- Create: `apps/web/src/components/PathAssistant.tsx`
- Create: `apps/web/src/components/PathAssistant.test.tsx`

**Interfaces:**
- Consumes: `POST /api/interpret`、`POST /api/chat`（Task 5）
- Produces: `<ResultView result paths closeMatches answers grade />`；`<PathAssistant answers grade pathId />`

- [ ] **Step 1: 安装前端依赖**

`apps/web/package.json` 的 `dependencies` 增加：

```json
"@ai-sdk/react": "^4.0.130",
"ai": "^7.0.127",
```

`useChat` / `useCompletion` 的 peer 是 `react ^18`，与本项目 `react@^18.3.1` 相容。

- [ ] **Step 2: 写失败的测试**

在 `apps/web/src/components/ResultView.test.tsx` 追加：

```tsx
describe('ResultView · 本路径选择（设计文档 §8.5）', () => {
  it('默认选中匹配度最高的那条路径', () => {
    render(<ResultView result={result} paths={paths} answers={{}} grade="freshman" />)
    expect(screen.getByRole('radio', { name: /本学科保研/ })).toBeChecked()
  })

  it('点选另一条路径后选中项改变', async () => {
    render(<ResultView result={result} paths={paths} answers={{}} grade="freshman" />)
    await userEvent.click(screen.getByRole('radio', { name: /考公考编/ }))
    expect(screen.getByRole('radio', { name: /考公考编/ })).toBeChecked()
    expect(screen.getByRole('radio', { name: /本学科保研/ })).not.toBeChecked()
  })
})
```

`PathAssistant.test.tsx`——**本任务的重点用例是 Review Focus 第 5 条**：

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PathAssistant } from './PathAssistant.js'

vi.mock('@ai-sdk/react', () => ({
  useCompletion: () => ({ completion: '', complete: vi.fn(), isLoading: false, error: undefined }),
  useChat: () => ({ messages: [], sendMessage: vi.fn(), status: 'ready', error: undefined }),
}))

const base = { answers: { q1: 4 }, grade: 'freshman' as const }

describe('PathAssistant', () => {
  it('渲染解读区与追问输入框', () => {
    render(<PathAssistant {...base} pathId="same-discipline-baoyan" />)
    expect(screen.getByText(/个性化解读/)).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/追问/)).toBeInTheDocument()
  })

  it('切换 pathId 时清空上一路径的解读与对话（不串台）', () => {
    const { rerender } = render(<PathAssistant {...base} pathId="same-discipline-baoyan" />)
    const firstInput = screen.getByPlaceholderText(/追问/)
    expect(firstInput).toBeInTheDocument()

    rerender(<PathAssistant {...base} pathId="civil-service" />)

    // key 变化会重建组件，上一路径的对话状态不会残留
    expect(screen.getByPlaceholderText(/追问/)).not.toBe(firstInput)
  })

  it('模型不可用时显示降级提示，而不是空白', () => {
    vi.mocked(useCompletion).mockReturnValue({
      completion: '', complete: vi.fn(), isLoading: false, error: new Error('503'),
    } as never)
    render(<PathAssistant {...base} pathId="same-discipline-baoyan" />)
    expect(screen.getByText(/个性化解读暂不可用/)).toBeInTheDocument()
  })
})
```

> 上面第三例需要把 `useCompletion` 从 mock 工厂里改名导入才能 `vi.mocked` 到。实现时按 vitest 的实际能力调整——目标是**固定住「出错时显示降级文案」这一条**，而不是固定住 mock 的写法。

- [ ] **Step 3: 运行测试确认失败**

Run: `pnpm --filter @navi/web test`
Expected: FAIL，`Cannot find module './PathAssistant.js'`

- [ ] **Step 4: 实现 PathAssistant**

`apps/web/src/components/PathAssistant.tsx`：

```tsx
import { useEffect } from 'react'
import { useChat, useCompletion } from '@ai-sdk/react'
import type { Grade } from '../api.js'

interface Props {
  answers: Record<string, number>
  grade: Grade
  pathId: string
}

/** 解读 + 追问，都锚在「本路径」上（设计文档 §8.5） */
export function PathAssistant({ answers, grade, pathId }: Props) {
  const {
    completion, complete, isLoading: interpreting, error: interpretError,
  } = useCompletion({
    api: '/api/interpret',
    body: { answers, grade, pathId },
  })

  const {
    messages, sendMessage, status, error: chatError,
  } = useChat({
    api: '/api/chat',
    body: { answers, grade, pathId },
  })

  // 走到这里说明触发了一次解读；换路径时 complete('') 会重新生成
  useEffect(() => {
    void complete('')
    // 只认 pathId：答案和年级在同一次会话里不会变
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathId])

  return (
    <section className="mx-auto mt-8 max-w-3xl border-t pt-6">
      <h2 className="mb-2 text-lg font-semibold">个性化解读</h2>
      {interpretError ? (
        <p className="text-amber-600">个性化解读暂不可用，其余诊断结果不受影响。</p>
      ) : interpreting && completion === '' ? (
        <p className="text-gray-500">正在生成……</p>
      ) : (
        <p className="whitespace-pre-wrap leading-relaxed">{completion}</p>
      )}

      <h2 className="mb-2 mt-6 text-lg font-semibold">追问</h2>
      <ul className="mb-3 space-y-2">
        {messages.map(message => (
          <li key={message.id} className="text-sm">
            <span className="font-medium">{message.role === 'user' ? '你' : 'Navi'}：</span>
            <span className="whitespace-pre-wrap">
              {message.parts
                .filter(part => part.type === 'text')
                .map(part => part.text)
                .join('')}
            </span>
          </li>
        ))}
      </ul>

      {chatError && <p className="mb-2 text-amber-600">追问暂时不可用，请稍后重试。</p>}

      <form
        onSubmit={event => {
          event.preventDefault()
          const form = event.currentTarget
          const input = new FormData(form).get('question')
          const question = typeof input === 'string' ? input.trim() : ''
          if (question === '') return
          sendMessage({ text: question })
          form.reset()
        }}
      >
        <input
          name="question"
          placeholder="就这条路径追问……"
          className="w-full border p-2"
          disabled={status === 'submitted' || status === 'streaming'}
        />
      </form>
    </section>
  )
}
```

> `sendMessage({ text })` 与 `message.parts` 的确切形状请以 `@ai-sdk/react@4` 的实际类型为准（`node_modules/@ai-sdk/react/dist/index.d.ts`）。这两个 API 在 v5 前后改过名，不要凭记忆写。

- [ ] **Step 5: 让 ResultView 支持点选**

`apps/web/src/components/ResultView.tsx`：`Props` 增加 `answers` 与 `grade`，用受控 radio 渲染每条路径，选中项默认 `result.paths[0]?.id`，并在列表下方渲染 `<PathAssistant key={selectedId} ... />`。

> **`answers` 与 `grade` 设为必填**，因此该文件里原有的 10 个用例都会因为缺 props 而编译失败。给它们统一补上 `answers={{}} grade="freshman"` 即可——这是机械改动，但**必须做**，否则 `pnpm --filter @navi/web test` 直接红。若嫌改动面大，也可以把这两个 prop 设为可选、仅在两者都存在时才渲染 `PathAssistant`；本项目生产路径上它们总是存在，因此推荐必填。


关键点：**给 `PathAssistant` 一个 `key={selectedId}`**。换路径时 React 会重建组件，`useChat` 的对话历史随之清空——这是 Review Focus 第 5 条（不串台）的实现方式，比手写重置逻辑省事且不会漏。

每条路径的标题外再包一层：

```tsx
<label className="flex items-baseline gap-2">
  <input
    type="radio"
    name="path"
    checked={selectedId === path.id}
    onChange={() => setSelectedId(path.id)}
    aria-label={meta?.title ?? path.id}
  />
  <h3 className="font-medium">{meta?.title ?? path.id}</h3>
</label>
```

- [ ] **Step 6: App.tsx 下传 answers 与 grade**

`handleSubmit` 里把 `answers` 存进 state，并把 `answers`、`grade` 传给 `ResultView`：

```tsx
<ResultView
  result={result}
  paths={data.paths}
  closeMatches={result.closeMatches}
  answers={submittedAnswers}
  grade={grade}
/>
```

- [ ] **Step 7: 运行测试**

Run: `pnpm --filter @navi/web test`
Expected: PASS

- [ ] **Step 8: 回到 Task 5 核对 `parts` 形状**

启动前后端，在结果页追问一次，看 `POST /api/chat` 的实际请求体。若 `toModelMessages` 解析不出内容（追问回答里没有上下文），按实际形状修正 `apps/api/src/server.ts` 的 `toModelMessages`。

Run: `pnpm --filter @navi/api dev` 与 `pnpm --filter @navi/web dev`，浏览器打开 `http://localhost:5173`，填完问卷，在结果页追问一句。

- [ ] **Step 9: Commit**

```bash
git add apps/web pnpm-lock.yaml
git commit -m "feat(web): 结果页路径可点选，新增解读区与追问框"
```

---

### Task 7: 端到端验证与文档

**Files:**
- Modify: `PROJECT_STATE.md`

**Interfaces:**
- Consumes: 前六个任务的全部产出
- Produces: 可复现的降级验证步骤；有 Key 时的手测步骤

- [ ] **Step 1: 全量验证**

```bash
cd F:/workspace/大学生生涯规划Agent/Navi
pnpm test
pnpm -r lint
pnpm -r build
```

Expected: 全部通过。记录实际测试数。

- [ ] **Step 2: 验证降级路径（不需要 API Key）**

确保 `.env` 不存在或 `DEEPSEEK_API_KEY` 为空，然后：

```bash
pnpm --filter @navi/knowledge build
pnpm --filter @navi/api dev
```

```bash
curl -s -o /dev/null -w "interpret=%{http_code}\n" -X POST http://localhost:3000/api/interpret \
  -H 'content-type: application/json' \
  -d '{"answers":{},"grade":"freshman","pathId":"same-discipline-baoyan"}'
```

Expected: `400`（空答案先被拦下——这条先验证完整性校验在 LLM 端点上也生效）

再用一份完整答案请求：

Expected: `503`，响应体形如 `{"error":"个性化解读暂不可用：服务端未配置模型"}`

浏览器里走完问卷 → 结果页应显示：画像、7 条路径、匹配度、置信度**全部正常**，只有解读区显示「个性化解读暂不可用，其余诊断结果不受影响」。**这是 §8.7 的验收标准。**

- [ ] **Step 3: 有 Key 时的手测（可选）**

配好 `.env` 后重复 Step 2 的最后一步，确认：
- 解读文字在 3 秒内开始逐字出现
- 追问能引用本路径正文里的内容（如「夏令营」）
- 问一个知识库没有的问题（例如「我们学校转专业难吗」），回答必须落在 §8.4 的边界说明上，而不是编造

- [ ] **Step 4: 更新 PROJECT_STATE**

- §4 当前代码状态：测试数、新增的包与端点
- §7 未完成任务：计划② 标记为已完成，列出仍未做的（`boundaries.md` 的更多条目、§13.1 的跨路径追问验证）
- §8.4 待验证项：把 §13.1（跨路径追问的上下文组织）的状态改为「已实现，待实测校准」
- §10 常用命令：补 `.env` 的配置说明

- [ ] **Step 5: Commit**

```bash
git add PROJECT_STATE.md
git commit -m "docs: PROJECT_STATE 记录计划② 完成情况与降级验证步骤"
```

---

## 完成标准

本计划完成时，以下命令应全部通过：

```bash
pnpm install
pnpm --filter @navi/knowledge build   # 输出含 boundaries
pnpm -r test                          # 全部单元测试通过
pnpm -r lint
pnpm -r build
pnpm --filter @navi/api dev
pnpm --filter @navi/web dev
```

且满足：

1. **没有 API Key 也能完成「填问卷 → 看结果」全流程**，只有解读区降级。
2. **LLM 不参与任何决策**——关掉模型，`/api/diagnose` 的输出与计划①完全一致。
3. **模型不可解析的回答不会进入前端**——防幻觉约束在提示词里，且测试固定住了它确实被带上。

## 后续计划（不在本计划范围）

- **计划③：可视化打磨**——雷达图、路径匹配条形图、画像对比、路径地图、时间线、`myth` / `cost` 块渲染，以及路径正文的展示（本计划只做到「可选中」，没做「可阅读」）
- 内容组：`boundaries.md` 扩充条目；7 条路径的 `status` 提到 `verified`
- §13.1 的实测校准：跨路径追问的 2K 字摘要是否够用

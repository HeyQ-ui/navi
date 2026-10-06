# Navi 前端重设计实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 `docs/superpowers/specs/2026-10-06-navi-frontend-redesign-design.md`（下称 spec）全量重写 `apps/web`：新设计系统、wouter 路由、8 个页面、知识块渲染器、错误与降级状态，旧组件全部删除。

**Architecture:** 保留 `src/api.ts`（HTTP 客户端）并增量扩展；新增 `state.tsx`（FlowProvider，会话 / 答题流 / 结果全部存内存）承载跨页状态与登录守卫所需上下文；页面为薄壳，渲染逻辑集中在 `ResultBody`（结果页与历史详情共用）与 `BlockRenderer`（知识块）；解读流中的建议问题用 `【可以问我】` 文本标记由前端解析。

**Tech Stack:** React 18 · TypeScript · Vite · TailwindCSS 3 · wouter · Recharts · @ai-sdk/react · Vitest + Testing Library · @fontsource 自托管字体。

---

## 开始之前（执行者必读）

### 项目硬约束（AGENTS.md 摘录）

- 推荐结果必须由 `packages/core` 的确定性算法得出，大模型只做解读与追问。本计划**不改** `packages/core`。
- 知识库内容不得硬编码进 TS 源码；块内容由 `/api/knowledge/:pathId` 下发。
- 前端代码中不得出现 API Key。
- 提交信息用中文，Conventional Commits（`feat(web):` / `test(api):` 等）。
- 每个任务结束时 `pnpm --filter @navi/web test` 与 `pnpm --filter @navi/web lint` 必须绿；Task 14 做全仓验证。

### 现状快照（2026-10-06）

- 前端是旧状态机形态：`App.tsx` 用 `stage` 切换，组件在 `src/components/{Login,Questionnaire,ResultView,PathAssistant,History}.tsx`。这些文件与它们的测试在 **Task 14 统一删除**，此前的任务不得改动它们——中途任何提交都必须保持全量测试绿。
- `src/api.ts` 与 `src/api.test.ts` 保留并扩展（Task 2）。
- 服务端已有端点：`/api/questions`、`/api/diagnose`（要会话）、`/api/interpret`（纯文本流）、`/api/chat`、`/api/chat/history`、`/api/assessments`、`/api/assessments/:id`、`/api/knowledge/:pathId`。
- `result.archetypes` 已按亲和度降序（`packages/core/src/archetype.ts` 末尾 `.sort((a, b) => b.affinity - a.affinity)`）：`[0]` 是主原型，`[1]` 是次原型。
- 未登录访问 `/api/diagnose` 得 `401 {error:'未登录'}`；未配置 `JWT_SECRET` 时认证与受保护端点得 `503 {error:'账号功能暂不可用：服务端未配置会话密钥'}`。
- 时间线块 HTML 形如 `<h2>…</h2><ul><li><strong>大一上 · 12月</strong> 四级考试</li>…</ul>`；行动指南块形如 `<ul><li><strong>大一上</strong> 行动文字</li>…</ul>`。「现在」标记与两栏布局都靠解析 `<li>` 里的 `<strong>` 前缀实现。

### 对 spec §8.1「唯一接口层新增」的三处补充（评审已知）

spec §8.1 说接口层只新增建议问题字段，但 §5.5 / §5.7 有两处数据现有接口给不出来，本计划做了**最小增量**处理：

1. **新增 `GET /api/meta`**，返回 `{ archetypes, indicators }`。§5.5 的画像叙事需要原型的 `oneLiner / strengths / blindspots`（只存在于知识库 `ArchetypeDef`，现有端点不下发）；历史详情页还需要指标中文名画雷达图轴。
2. **`/api/assessments` 列表行追加 `archetypeName: string | null`**。§5.7 历史行元信息要「画像名」，列表接口原本没有。
3. **建议问题走流内文本标记**：`/api/interpret` 返回的是纯文本流（`toTextStreamResponse()`），无法附带 JSON 字段。实现方式为提示词要求解读末尾输出 `【可以问我】问题1 | 问题2 | 问题3` 一行，前端 `lib/suggestions.ts` 解析（流式中隐藏半截标记）。这是「由 LLM 随解读一并生成」的落地形态。

三者都是增量：不改既有字段、不破坏既有契约。

### 必须延续的行为契约（旧测试钉住、新测试重写）

| 契约 | 旧测试出处 | 新测试落点 |
|---|---|---|
| 服务端错误文案**原样**透出（含 503 的「未配置会话密钥」） | `App.test.tsx`、`api.test.ts` | `state.test.tsx`、`api.test.ts`（保留） |
| 登出只有服务端确认成功才清状态；失败留在原地报错 | `App.test.tsx` | `state.test.tsx` |
| 未答满不能前进；提交回传选项索引；每次进入从空白开始 | `Questionnaire.test.tsx` | `pages/QuizPage.test.tsx`、`state.test.tsx` |
| 主推荐 = 第一条**可适用**路径（高分但硬性不适用不进主位）；置信度永不展示；并列提示；待核实角标；空列表不崩 | `ResultView.test.tsx` | `components/ResultBody.test.tsx` |
| 全部路径不适用 → 显式态，解读区不挂载 | `ResultView.test.tsx` | `components/ResultBody.test.tsx` |
| 解读锚在主推荐路径；已有解读直接渲染、不重新生成 | `PathAssistant.test.tsx` | `components/InterpretSection.test.tsx` |
| 请求体带 `assessmentId + pathId`；对话历史用**更新函数**合并、不冲掉在途轮次 | `PathAssistant.test.tsx` | `components/InterpretSection.test.tsx` |
| 纯文本流按 `streamProtocol: 'text'` 消费（否则结束后解读变空白） | `PathAssistant.stream.test.tsx` | `components/InterpretSection.stream.test.tsx` |
| 历史列表空态 / 错误态 / 点行回传 id | `History.test.tsx` | `pages/HistoryPage.test.tsx` |
| 没有可作答题目 → 「信息不足」显式态，不撞 400 | `App.test.tsx` | `pages/GradePage.test.tsx` |
| 登录失败显示服务端文案；字段是**账号**不是邮箱（全站禁现「邮箱」字样） | `Login.test.tsx` + spec 验收 3 | `pages/AuthPage.test.tsx` |

### 新测试相对旧契约的两处**有意变更**（spec 已定）

1. 解读 503 / 无输出时报错 → 旧行为是显示「暂不可用」提示，新行为是**整区隐藏**（spec §7.3）。
2. 其他路径从只读折叠区 → **可点击**进入各自详情页（spec 差异表 #2）。

---

## 文件结构

| 动作 | 文件 | 职责 |
|---|---|---|
| 改 | `apps/web/package.json` | 增加 wouter / recharts / @fontsource 依赖 |
| 改 | `apps/web/tailwind.config.js` | 设计令牌（色板、字体、圆角、动画） |
| 改 | `apps/web/src/index.css` | 基础样式、共享组件类、知识块排版、动效与降级 |
| 改 | `apps/web/src/main.tsx` | 字体导入 |
| 改 | `apps/web/src/api.ts` | `ApiHttpError`、`fetchMeta`、`fetchPathKnowledge`、`archetypeName` |
| 改 | `apps/web/src/api.test.ts` | 追加新函数测试 |
| 新 | `apps/web/src/lib/suggestions.ts` | 建议问题标记解析（含流式半截隐藏） |
| 新 | `apps/web/src/lib/result-math.ts` | 雷达行 / 差距榜 / 主推荐选取（纯函数） |
| 新 | `apps/web/src/lib/use-title.ts` | 浏览器标题 hook |
| 新 | `apps/web/src/state.tsx` | FlowProvider：会话、答题流、结果、登录回跳 |
| 新 | `apps/web/src/components/TopBar.tsx` | 顶栏（品牌 + 历史入口 + 账号菜单） |
| 新 | `apps/web/src/components/StatusBadge.tsx` | 待核实角标（verified 不渲染） |
| 新 | `apps/web/src/components/ProfileRadar.tsx` | Recharts 雷达封装（单形 / 叠加两态） |
| 新 | `apps/web/src/components/BlockRenderer.tsx` | 知识块渲染 + 时间线「现在」标记 + 降级 |
| 新 | `apps/web/src/components/InterpretSection.tsx` | 流式解读 + 建议芯片 + 追问 |
| 新 | `apps/web/src/components/ResultBody.tsx` | 结果页四段叙事（结果与历史详情共用） |
| 新 | `apps/web/src/pages/{Home,Auth,Grade,Quiz,Result,PathDetail,History,HistoryDetail}Page.tsx` | 8 个页面 |
| 改 | `apps/web/src/App.tsx` | wouter 路由 + 状态守卫 + 路由过渡 |
| 删 | `apps/web/src/components/{Login,Questionnaire,ResultView,PathAssistant,History}.tsx` 及全部同名测试 | 旧组件（Task 14） |
| 改 | `apps/api/src/server.ts` | `GET /api/meta`；列表行 `archetypeName` |
| 改 | `apps/api/src/server.test.ts` | 对应端点测试 |
| 改 | `packages/llm/prompts/interpret.md` | 末尾追加 `【可以问我】` 行要求 |
| 改 | `packages/llm/src/prompts.test.ts` | 钉住该要求 |

---

### Task 1: 依赖与设计令牌

**Files:**
- Modify: `apps/web/package.json`
- Modify: `apps/web/tailwind.config.js`
- Modify: `apps/web/src/index.css`
- Modify: `apps/web/src/main.tsx`

- [ ] **Step 1: 安装依赖**

```bash
pnpm --filter @navi/web add wouter recharts
pnpm --filter @navi/web add @fontsource/noto-serif-sc @fontsource/fraunces
```

- [ ] **Step 2: Tailwind 主题令牌**

整体替换 `apps/web/tailwind.config.js`：

```js
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        paper: '#F7F3EC',
        surface: '#FFFDF9',
        ink: '#201A14',
        'ink-2': '#6E6459',
        'ink-3': '#A39888',
        line: '#E6DDD0',
        accent: { DEFAULT: '#E05A1F', soft: '#FBEADF', deep: '#93380F' },
        warn: { DEFAULT: '#B07C1F', soft: '#F5EDDA' },
        bad: { DEFAULT: '#B23B2E', soft: '#F7E9E5' },
        ok: { DEFAULT: '#4A7C59', soft: '#EAEFE8' },
      },
      fontFamily: {
        serif: ['"Noto Serif SC"', '"Songti SC"', 'SimSun', 'serif'],
        sans: ['"PingFang SC"', '"HarmonyOS Sans SC"', '"Microsoft YaHei"', 'sans-serif'],
        num: ['Fraunces', '"Noto Serif SC"', 'serif'],
      },
      maxWidth: { prose: '760px' },
      borderRadius: { panel: '14px' },
      keyframes: {
        rise: {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        blink: { '0%,100%': { opacity: '1' }, '50%': { opacity: '0' } },
      },
      animation: {
        rise: 'rise 220ms ease-out both',
        blink: 'blink 1s step-end infinite',
      },
    },
  },
  plugins: [],
}
```

说明：`warn-soft` 是 spec §3.1 之外的补充令牌——待核实角标与误区芯片需要琥珀浅底，spec 只给了 `warn` 字色。

- [ ] **Step 3: 全局样式与共享组件类**

整体替换 `apps/web/src/index.css`：

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  html {
    @apply bg-paper font-sans text-[16px] leading-[1.9] text-ink;
  }
  /* 纸纹：SVG 噪点 3% 透明度，不引图片资源（spec §3.3） */
  body::before {
    content: '';
    position: fixed;
    inset: 0;
    z-index: -1;
    opacity: 0.03;
    pointer-events: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)'/%3E%3C/svg%3E");
  }
}

@layer components {
  .btn-primary {
    @apply inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-6 py-2.5 text-[15px] text-white transition-colors hover:bg-accent-deep disabled:cursor-not-allowed disabled:opacity-60;
  }
  .btn-secondary {
    @apply inline-flex items-center justify-center gap-2 rounded-lg border border-accent/40 px-6 py-2.5 text-[15px] text-accent-deep transition-colors hover:bg-accent-soft;
  }
  .field-input {
    @apply w-full rounded-lg border border-line bg-paper px-3.5 py-2.5 text-[15px] outline-none transition focus:border-accent focus:ring-[3px] focus:ring-accent-soft;
  }
  .panel {
    @apply rounded-panel border border-line bg-surface;
  }
  .section-head {
    @apply mb-6 flex items-baseline gap-3 border-b border-line pb-3;
  }
  .section-num {
    @apply font-num text-[15px] font-semibold text-accent;
  }
  .section-title {
    @apply font-serif text-[19px] font-black;
  }
  .chip {
    @apply inline-flex items-center rounded-md border px-2 py-0.5 text-[12px] leading-5;
  }
  .spinner {
    @apply inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white;
  }
  .skeleton {
    @apply animate-pulse rounded-md bg-line/70;
  }
}

/* 知识块富文本排版（作用域类 .kb，块内容来自自有编译器，可信） */
.kb p { margin-bottom: 0.5em; }
.kb p:last-child { margin-bottom: 0; }
.kb ul { list-style: disc; padding-left: 1.4em; display: grid; gap: 6px; }
.kb strong { @apply font-semibold text-ink; }
.kb table { width: 100%; border-collapse: collapse; font-size: 14px; }
.kb th, .kb td { border: 1px solid #E6DDD0; padding: 8px 10px; text-align: left; }
.kb th { background: #F7F3EC; }

/* 代价 / 风险块：列表符号换成 － 与 △（spec §6） */
.kb-cost ul, .kb-risk ul { list-style: none; padding-left: 0; }
.kb-cost li, .kb-risk li { position: relative; padding-left: 1.4em; }
.kb-cost li::before { content: '－'; position: absolute; left: 0; color: #6E6459; }
.kb-risk li::before { content: '△'; position: absolute; left: 0; color: #B23B2E; }

/* 流式解读光标 */
.stream-cursor {
  @apply inline-block h-[1em] w-[2px] translate-y-[2px] animate-blink bg-accent;
}

/* 滚动显现：一次性，不重复播放（spec §3.4 第 4 条） */
.reveal { opacity: 0; transform: translateY(8px); transition: opacity 240ms ease-out, transform 240ms ease-out; }
.reveal.is-in { opacity: 1; transform: none; }

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation: none !important; transition: none !important; }
  .reveal { opacity: 1; transform: none; }
}
```

- [ ] **Step 4: 字体导入**

修改 `apps/web/src/main.tsx`，在 `import { App }` 之前加入字体（`@fontsource` 即自托管 woff2，`font-display: swap` 由其 css 提供，满足 spec §8.3）：

```tsx
import '@fontsource/noto-serif-sc/600.css'
import '@fontsource/noto-serif-sc/900.css'
import '@fontsource/fraunces/500.css'
import '@fontsource/fraunces/600.css'
```

- [ ] **Step 5: 验证**

Run: `pnpm --filter @navi/web build && pnpm --filter @navi/web test`
Expected: 类型检查通过，既有测试全绿（本任务不改任何组件）。

- [ ] **Step 6: Commit**

```bash
git add apps/web/package.json apps/web/tailwind.config.js apps/web/src/index.css apps/web/src/main.tsx pnpm-lock.yaml
git commit -m "chore(web): 引入路由/图表/字体依赖与设计令牌"
```

---

### Task 2: api.ts 扩展（错误状态码、/api/meta、路径知识）

**Files:**
- Modify: `apps/web/src/api.ts`
- Test: `apps/web/src/api.test.ts`

- [ ] **Step 1: 写失败测试**

在 `apps/web/src/api.test.ts` 顶部 import 中补上新导出，并追加：

```ts
import { ApiHttpError, fetchMeta, fetchPathKnowledge } from './api.js'

describe('ApiHttpError', () => {
  it('非 2xx 时携带状态码，供调用方区分 401（会话失效）与其他错误', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: '未登录' }), { status: 401 }),
    )
    const err = await postDiagnose({ q1: 4 }, 'freshman', 'self').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiHttpError)
    expect((err as ApiHttpError).status).toBe(401)
    expect((err as Error).message).toBe('未登录')
  })
})

describe('fetchMeta', () => {
  it('返回画像原型与指标定义', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ archetypes: [], indicators: [] }), { status: 200 }),
    )
    await expect(fetchMeta()).resolves.toEqual({ archetypes: [], indicators: [] })
  })
})

describe('fetchPathKnowledge', () => {
  it('按路径 id 取完整路径定义与知识块，并做 URL 编码', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ path: { id: 'a b' }, blocks: [] }), { status: 200 }),
    )
    await fetchPathKnowledge('a b')
    expect(vi.mocked(globalThis.fetch).mock.calls[0]![0]).toBe('/api/knowledge/a%20b')
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @navi/web test`
Expected: FAIL——`ApiHttpError / fetchMeta / fetchPathKnowledge` 未导出。

- [ ] **Step 3: 实现**

修改 `apps/web/src/api.ts`：

1. 首行类型导入扩为：

```ts
import type {
  ArchetypeDef, Block, DiagnosisResult, IndicatorDef, PathDef, Question,
} from '@navi/core'

export type { ArchetypeDef, Block, DiagnosisResult, IndicatorDef, PathDef, Question }
```

（原有 `export type { PathResult, IndicatorScore, Contribution, EligibilityFailure }` 保留；`export type { DiagnosisResult, Question }` 两行合并进上面，避免重复。）

2. `jsonOrThrow` 改抛带状态码的错误（文案契约不变）：

```ts
/** 非 2xx 时把服务端的错误文案抛出来，让调用方能直接显示；status 供区分 401 会话失效 */
export class ApiHttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'ApiHttpError'
  }
}

async function jsonOrThrow(res: Response, what: string): Promise<unknown> {
  if (res.ok) return res.json()
  const body = (await res.json().catch(() => ({}))) as { error?: string }
  throw new ApiHttpError(body.error ?? `${what}失败：${res.status}`, res.status)
}
```

3. `AssessmentSummary` 追加字段：

```ts
  /** 主原型中文名，服务端从 result 快照推出；旧记录可能没有 */
  archetypeName: string | null
```

4. 文件末尾追加两个函数：

```ts
/** 画像原型叙事与指标中文名——结果页画像段与雷达轴需要（前端重设计 spec §5.5） */
export interface MetaResponse {
  archetypes: ArchetypeDef[]
  indicators: IndicatorDef[]
}

export async function fetchMeta(): Promise<MetaResponse> {
  const res = await fetch('/api/meta')
  return (await jsonOrThrow(res, '获取画像原型')) as MetaResponse
}

/** 路径完整定义（含理想画像权重）+ 知识块。内容块渲染与「你和这条路」对比都靠它 */
export interface PathKnowledge {
  path: PathDef
  blocks: Block[]
}

export async function fetchPathKnowledge(pathId: string): Promise<PathKnowledge> {
  const res = await fetch(`/api/knowledge/${encodeURIComponent(pathId)}`)
  return (await jsonOrThrow(res, '获取路径知识')) as PathKnowledge
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @navi/web test`
Expected: PASS（既有用例断言的是 message，`ApiHttpError` 兼容）。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/api.ts apps/web/src/api.test.ts
git commit -m "feat(web): api 层补充状态码错误、画像原型与路径知识获取"
```

---

### Task 3: 服务端 /api/meta 与历史列表画像名

**Files:**
- Modify: `apps/api/src/server.ts`
- Test: `apps/api/src/server.test.ts`

- [ ] **Step 1: 写失败测试**

在 `apps/api/src/server.test.ts` 追加（`authedApp` / `diagnoseOnce` 复用文件内既有夹具）：

```ts
describe('GET /api/meta', () => {
  it('返回画像原型与指标定义，供结果页画像叙事与雷达轴使用', async () => {
    const res = await createApp(bundle).request('/api/meta')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      archetypes: bundle.archetypes,
      indicators: bundle.indicators,
    })
  })
})

describe('GET /api/assessments · 画像名', () => {
  it('列表行带上主原型的中文名', async () => {
    const { app, cookie } = await authedApp()
    await diagnoseOnce(app, cookie)
    const res = await app.request('/api/assessments', { headers: { cookie } })
    const body = await res.json() as { assessments: Array<{ archetypeName: string | null }> }
    expect(body.assessments[0]!.archetypeName).toBe('稳健学术型')
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @navi/api test`
Expected: FAIL——404 与 `archetypeName` 为 undefined。

- [ ] **Step 3: 实现**

修改 `apps/api/src/server.ts`：

1. 在 `app.get('/api/questions', …)` 之后加：

```ts
  // 结果页画像段需要原型叙事（oneLiner/优势/盲点），雷达轴需要指标中文名；
  // 历史详情没有 /api/questions 的上下文，统一从这里取
  app.get('/api/meta', c => {
    return c.json({ archetypes: bundle.archetypes, indicators: bundle.indicators })
  })
```

2. `/api/assessments` 处理函数里，`titles` 旁加一张原型名表，并在 `assessments.push` 的对象里追加字段：

```ts
    const titles = new Map(bundle.paths.map(p => [p.id, p.title]))
    const archetypeNames = new Map(bundle.archetypes.map(a => [a.id, a.name]))
```

```ts
        const main = findTiedPaths(row.result)[0]
        // 旧 schema 记录可能没有 archetypes 数组，取不到就是 null，不让它抛错
        const topArchetype = row.result.archetypes?.[0]
        assessments.push({
          id: row.id,
          source: row.source,
          grade: row.grade,
          createdAt: row.createdAt,
          mainPathId: main?.id ?? null,
          mainPathTitle: main === undefined ? null : (titles.get(main.id) ?? main.id),
          match: main === undefined ? null : Math.round(main.match),
          archetypeName: topArchetype === undefined
            ? null
            : (archetypeNames.get(topArchetype.id) ?? topArchetype.id),
        })
```

（`archetypeName` 写在既有 `try` 块内，坏数据照样被逐行兜住。）

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @navi/api test`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/server.ts apps/api/src/server.test.ts
git commit -m "feat(api): 新增 /api/meta，历史列表行补充画像名"
```

---

### Task 4: 建议问题（提示词 + 流内标记解析）

**Files:**
- Modify: `packages/llm/prompts/interpret.md`
- Test: `packages/llm/src/prompts.test.ts`
- Create: `apps/web/src/lib/suggestions.ts`
- Test: `apps/web/src/lib/suggestions.test.ts`

- [ ] **Step 1: 提示词测试（失败）**

在 `packages/llm/src/prompts.test.ts` 的「提示词 · 解读的输出结构」describe 里追加：

```ts
  it('要求解读末尾以【可以问我】行给出建议问题（前端重设计 spec §8.2）', () => {
    const text = prompt('interpret')
    expect(text).toContain('【可以问我】')
    expect(text).toContain('1–3 条')
  })
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @navi/llm test`
Expected: FAIL。

- [ ] **Step 3: 修改提示词**

在 `packages/llm/prompts/interpret.md` 的「## 输出要求」一节末尾追加一条：

```markdown
- 正文之后另起一行，附上建议问题行，格式固定为 `【可以问我】问题1 | 问题2 | 问题3`：1–3 条，每条不超过 20 字，从这位学生的处境与这条路径出发，写他自然会想问的话。这一行由程序解析，格式必须精确：不加序号、不换行、分隔符用 ` | `。
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @navi/llm test`
Expected: PASS。

- [ ] **Step 5: 解析器测试（失败）**

新建 `apps/web/src/lib/suggestions.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { splitSuggestions, SUGGESTION_MARKER } from './suggestions.js'

describe('splitSuggestions', () => {
  it('没有标记时原样返回', () => {
    expect(splitSuggestions('正文内容', false)).toEqual({ body: '正文内容', suggestions: [] })
  })

  it('流结束后解析出建议问题，标记行不进正文', () => {
    const text = `保研是时间窗最紧的一条路。\n${SUGGESTION_MARKER}保研率大概多少？ | 大一该做什么？`
    expect(splitSuggestions(text, false)).toEqual({
      body: '保研是时间窗最紧的一条路。',
      suggestions: ['保研率大概多少？', '大一该做什么？'],
    })
  })

  it('空项过滤、最多 3 条、兼容全角分隔符', () => {
    const text = `${SUGGESTION_MARKER}a |  ｜ b | c | d`
    expect(splitSuggestions(text, false).suggestions).toEqual(['a', 'b', 'c'])
  })

  it('流式中：标记行整体隐藏，不出芯片', () => {
    const text = `正文。\n${SUGGESTION_MARKER}只写了一半`
    expect(splitSuggestions(text, true)).toEqual({ body: '正文。', suggestions: [] })
  })

  it('流式中：正文末尾刚写出半截标记时，连半截也不显示', () => {
    for (let len = 1; len < SUGGESTION_MARKER.length; len += 1) {
      const tail = SUGGESTION_MARKER.slice(0, len)
      const { body } = splitSuggestions(`正文${tail}`, true)
      expect(body).toBe('正文')
    }
  })

  it('流结束后半截标记就是正文的一部分，照常显示', () => {
    expect(splitSuggestions('正文【可以问', false).body).toBe('正文【可以问')
  })
})
```

- [ ] **Step 6: 运行确认失败**

Run: `pnpm --filter @navi/web test`
Expected: FAIL——模块不存在。

- [ ] **Step 7: 实现解析器**

新建 `apps/web/src/lib/suggestions.ts`：

```ts
/**
 * 解读流末尾的建议问题标记（前端重设计 spec §8.2 的落地形态）。
 * /api/interpret 是纯文本流，附不了 JSON 字段，约定由模型在末尾输出
 * `【可以问我】问题1 | 问题2 | 问题3` 一行，这里负责拆出来。
 */
export const SUGGESTION_MARKER = '【可以问我】'

const MAX_SUGGESTIONS = 3

export interface ParsedInterpretation {
  /** 展示用正文：标记行已剥离；流式中连半截标记尾巴也藏住 */
  body: string
  /** 解析出的建议问题；只有流结束且标记行完整才有值 */
  suggestions: string[]
}

export function splitSuggestions(text: string, streaming: boolean): ParsedInterpretation {
  const at = text.indexOf(SUGGESTION_MARKER)
  if (at !== -1) {
    const body = text.slice(0, at).replace(/\s+$/, '')
    if (streaming) return { body, suggestions: [] }
    const suggestions = text.slice(at + SUGGESTION_MARKER.length)
      .split(/[|｜]/)
      .map(s => s.trim())
      .filter(s => s !== '')
      .slice(0, MAX_SUGGESTIONS)
    return { body, suggestions }
  }

  if (streaming) {
    // 标记是一个字一个字蹦出来的：尾巴恰好是标记前缀时先藏住，
    // 否则用户会看到「【可以问我」逐字闪现。不是前缀的正文不受影响
    for (let len = SUGGESTION_MARKER.length - 1; len > 0; len -= 1) {
      if (text.endsWith(SUGGESTION_MARKER.slice(0, len))) {
        return { body: text.slice(0, -len), suggestions: [] }
      }
    }
  }
  return { body: text, suggestions: [] }
}
```

- [ ] **Step 8: 运行确认通过**

Run: `pnpm --filter @navi/web test`
Expected: PASS。

- [ ] **Step 9: Commit**

```bash
git add packages/llm/prompts/interpret.md packages/llm/src/prompts.test.ts apps/web/src/lib/suggestions.ts apps/web/src/lib/suggestions.test.ts
git commit -m "feat: 解读末尾产出建议问题行，前端解析器含流式半截隐藏"
```

---

### Task 5: 结果页纯函数 result-math

**Files:**
- Create: `apps/web/src/lib/result-math.ts`
- Test: `apps/web/src/lib/result-math.test.ts`

- [ ] **Step 1: 写失败测试**

新建 `apps/web/src/lib/result-math.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { radarRows, gapRows, mainPathOf, PROFILE_INDICATORS } from './result-math.js'
import type { DiagnosisResult } from '@navi/core'

const indicators = [
  { id: 'academic-interest', name: '学术志趣' },
  { id: 'accumulation-drive', name: '积累行动力' },
  { id: 'grad-intention-baoyan', name: '保研意愿' },
]

function score(score: number) {
  return { score, known: true, consistency: 1, sources: [] }
}

const result: DiagnosisResult = {
  indicators: {
    'academic-interest': score(80),
    'accumulation-drive': score(60),
    'grad-intention-baoyan': score(90),
  },
  paths: [],
  archetypes: [],
}

describe('radarRows', () => {
  it('只取 7 个画像类指标，意愿类不入图（主文档 §9.2）', () => {
    const rows = radarRows(result, indicators)
    expect(rows.map(r => r.id)).toEqual(['academic-interest', 'accumulation-drive'])
    expect(PROFILE_INDICATORS).not.toContain('grad-intention-baoyan')
    expect(rows[0]).toMatchObject({ name: '学术志趣', score: 80 })
  })

  it('未知（known=false）的指标不入图', () => {
    const r = { ...result, indicators: { 'academic-interest': { ...score(80), known: false } } }
    expect(radarRows(r, indicators)).toHaveLength(1)
  })

  it('给理想值时带上 ideal 字段', () => {
    const rows = radarRows(result, indicators, id => (id === 'academic-interest' ? 95 : undefined))
    expect(rows[0]!.ideal).toBe(95)
    expect(rows[1]!.ideal).toBeUndefined()
  })
})

describe('gapRows', () => {
  const weights = [
    { indicator: 'academic-interest' as const, weight: 1, ideal: 95 },
    { indicator: 'accumulation-drive' as const, weight: 1, ideal: 90 },
    { indicator: 'grad-intention-baoyan' as const, weight: 1, ideal: 92 },
  ]

  it('按差距降序取前 3，带上你/理想两个值', () => {
    const rows = gapRows(result, indicators, weights)
    expect(rows).toHaveLength(3)
    expect(rows[0]).toMatchObject({ id: 'accumulation-drive', score: 60, ideal: 90, gap: 30 })
    expect(rows[1]).toMatchObject({ id: 'grad-intention-baoyan', gap: 2 })
    expect(rows[2]).toMatchObject({ id: 'academic-interest', gap: 15 })
  })
})

describe('mainPathOf', () => {
  const applicable = {
    id: 'a', match: 70, confidence: 1, contributions: [],
    eligibility: { applicable: true, hardFailures: [], softWarnings: [] },
  }
  const blocked = {
    id: 'b', match: 99, confidence: 1, contributions: [],
    eligibility: { applicable: false, hardFailures: [{ id: 'x', severity: 'hard' as const, message: 'm' }], softWarnings: [] },
  }

  it('主推荐是第一条可适用路径，分再高的不适用路径也不算', () => {
    expect(mainPathOf({ ...result, paths: [blocked, applicable] })!.id).toBe('a')
  })

  it('全部不适用时返回 null', () => {
    expect(mainPathOf({ ...result, paths: [blocked] })).toBeNull()
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @navi/web test`
Expected: FAIL——模块不存在。

- [ ] **Step 3: 实现**

新建 `apps/web/src/lib/result-math.ts`：

```ts
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
    .map(w => {
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
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @navi/web test`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/result-math.ts apps/web/src/lib/result-math.test.ts
git commit -m "feat(web): 结果页纯函数——雷达行、差距榜、主推荐选取"
```

---

### Task 6: 全局状态 FlowProvider

**Files:**
- Create: `apps/web/src/state.tsx`
- Test: `apps/web/src/state.test.tsx`
- Create: `apps/web/src/lib/use-title.ts`

- [ ] **Step 1: 写失败测试**

新建 `apps/web/src/state.test.tsx`：

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import type { ReactNode } from 'react'
import { fetchMe, fetchQuestions, logout, postDiagnose } from './api.js'
import { ApiHttpError } from './api.js'
import { FlowProvider, useFlow } from './state.js'

vi.mock('./api.js', async () => {
  const actual = await vi.importActual<typeof import('./api.js')>('./api.js')
  return {
    ...actual,
    fetchMe: vi.fn(),
    fetchQuestions: vi.fn(),
    postDiagnose: vi.fn(),
    authenticate: vi.fn(),
    logout: vi.fn(),
    fetchMeta: vi.fn(),
  }
})

const wrapper = ({ children }: { children: ReactNode }) => <FlowProvider>{children}</FlowProvider>

const diagnosis = {
  indicators: {}, paths: [], archetypes: [], tiedPaths: [], assessmentId: 'a1',
}

beforeEach(() => {
  vi.mocked(fetchMe).mockResolvedValue(null)
  vi.mocked(fetchQuestions).mockResolvedValue({ questions: [], indicators: [], paths: [] })
  vi.mocked(postDiagnose).mockResolvedValue(diagnosis)
  vi.mocked(logout).mockResolvedValue(undefined)
})

describe('FlowProvider · 会话探测', () => {
  it('已登录时带出账号', async () => {
    vi.mocked(fetchMe).mockResolvedValue({ id: 'u1', username: 'tester' })
    const { result } = renderHook(() => useFlow(), { wrapper })
    await waitFor(() => expect(result.current.authReady).toBe(true))
    expect(result.current.account?.username).toBe('tester')
  })

  it('探测失败时原样保留服务端原因——泛化文案会误导排查方向', async () => {
    vi.mocked(fetchMe).mockRejectedValue(new Error('账号功能暂不可用：服务端未配置会话密钥'))
    const { result } = renderHook(() => useFlow(), { wrapper })
    await waitFor(() => expect(result.current.authReady).toBe(true))
    expect(result.current.authError).toBe('账号功能暂不可用：服务端未配置会话密钥')
  })

  it('抛出非 Error 时用一句兜底文案', async () => {
    vi.mocked(fetchMe).mockRejectedValue('boom')
    const { result } = renderHook(() => useFlow(), { wrapper })
    await waitFor(() => expect(result.current.authReady).toBe(true))
    expect(result.current.authError).toBe('无法连接服务端，请稍后重试')
  })
})

describe('FlowProvider · 登出', () => {
  it('成功后清空状态；失败抛出且不假装已登出', async () => {
    vi.mocked(fetchMe).mockResolvedValue({ id: 'u1', username: 'tester' })
    const { result } = renderHook(() => useFlow(), { wrapper })
    await waitFor(() => expect(result.current.account).not.toBeNull())

    vi.mocked(logout).mockRejectedValue(new Error('登出失败：500'))
    await expect(
      act(async () => { await result.current.signOut() }),
    ).rejects.toThrow('登出失败：500')
    expect(result.current.account).not.toBeNull()

    vi.mocked(logout).mockResolvedValue(undefined)
    await act(async () => { await result.current.signOut() })
    expect(result.current.account).toBeNull()
  })
})

describe('FlowProvider · 答题流', () => {
  it('选年级取题：有题返回 ok，空题返回 empty，失败返回 error 且文案透出', async () => {
    const { result } = renderHook(() => useFlow(), { wrapper })
    await waitFor(() => expect(result.current.authReady).toBe(true))

    // beforeEach 的 mock 返回空题目——这正是「信息不足」态，不能放进问卷
    await act(async () => { expect(await result.current.chooseGrade('freshman')).toBe('empty') })
    expect(result.current.data).toEqual({ questions: [], indicators: [], paths: [] })

    vi.mocked(fetchQuestions).mockResolvedValue({
      questions: [{ id: 'q1', text: 't', options: ['a'], weight: 1 }],
      indicators: [], paths: [],
    })
    await act(async () => { expect(await result.current.chooseGrade('freshman')).toBe('ok') })

    vi.mocked(fetchQuestions).mockRejectedValue(new Error('获取问卷失败：500'))
    await act(async () => { expect(await result.current.chooseGrade('sophomore')).toBe('error') })
    expect(result.current.questionsError).toBe('获取问卷失败：500')
  })

  it('换年级与开始新测评都会清空作答——作答只属于这一次测试', async () => {
    vi.mocked(fetchQuestions).mockResolvedValue({
      questions: [{ id: 'q1', text: 't', options: ['a'], weight: 1 }],
      indicators: [], paths: [],
    })
    const { result } = renderHook(() => useFlow(), { wrapper })
    await act(async () => { await result.current.chooseGrade('freshman') })
    act(() => result.current.setAnswer('q1', 2))
    expect(result.current.answers).toEqual({ q1: 2 })

    await act(async () => { await result.current.chooseGrade('junior') })
    expect(result.current.answers).toEqual({})
  })
})

describe('FlowProvider · 提交', () => {
  async function readyFlow() {
    const { result } = renderHook(() => useFlow(), { wrapper })
    await waitFor(() => expect(result.current.authReady).toBe(true))
    await act(async () => { await result.current.chooseGrade('freshman') })
    return result
  }

  it('成功时存结果并返回 ok', async () => {
    const result = await readyFlow()
    let outcome: string = ''
    await act(async () => { outcome = await result.current.submit() })
    expect(outcome).toBe('ok')
    expect(result.current.result?.assessmentId).toBe('a1')
  })

  it('401（会话失效）返回 auth 并记下回跳重提，其余错误返回 error 且文案透出', async () => {
    const result = await readyFlow()

    vi.mocked(postDiagnose).mockRejectedValue(new ApiHttpError('未登录', 401))
    let outcome = ''
    await act(async () => { outcome = await result.current.submit() })
    expect(outcome).toBe('auth')
    expect(result.current.resubmitAfterLogin).toBe(true)
    expect(result.current.authRedirect).toBe('/quiz')

    vi.mocked(postDiagnose).mockRejectedValue(new ApiHttpError('以下题目未作答：q2', 400))
    await act(async () => { outcome = await result.current.submit() })
    expect(outcome).toBe('error')
    expect(result.current.submitError).toBe('以下题目未作答：q2')
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @navi/web test`
Expected: FAIL——`state.js` 不存在。

- [ ] **Step 3: 实现 state.tsx**

新建 `apps/web/src/state.tsx`：

```tsx
import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import {
  ApiHttpError, authenticate, fetchMe, fetchMeta, fetchQuestions, logout, postDiagnose,
} from './api.js'
import type {
  Account, AssessmentSource, DiagnosisResponse, Grade, MetaResponse, QuestionsResponse,
} from './api.js'

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

export interface FlowValue {
  account: Account | null
  authReady: boolean
  /** 会话探测失败的原因，原样来自服务端——显示时不得改写 */
  authError: string
  signIn(mode: 'login' | 'register', username: string, password: string): Promise<void>
  signOut(): Promise<void>

  source: AssessmentSource
  /** 从首页点「测测自己/测测别人」：换一次测评，此前作答与结果全部作废 */
  startAssessment(source: AssessmentSource): void

  grade: Grade | null
  data: QuestionsResponse | null
  questionsLoading: boolean
  questionsError: string
  /** 'ok' 进问卷；'empty' 题目为空（信息不足，留在年级页）；'error' 取题失败（questionsError 已置） */
  chooseGrade(grade: Grade): Promise<'ok' | 'empty' | 'error'>

  answers: Record<string, number>
  setAnswer(questionId: string, optionIndex: number): void

  result: DiagnosisResponse | null
  submitting: boolean
  submitError: string
  /** 'ok' 跳结果页；'auth' 会话失效（已置好回跳 /quiz）；'error' 原地显示 submitError */
  submit(): Promise<'ok' | 'auth' | 'error'>
  /** 提交时撞 401 → 登录回来后问卷页自动重提一次，不重新答题（spec §4.2） */
  resubmitAfterLogin: boolean

  /** 登录成功后去哪；进 /auth 前由调用方置好 */
  authRedirect: string | null
  setAuthRedirect(to: string | null): void
}

const FlowContext = createContext<FlowValue | null>(null)

export function FlowProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<Account | null>(null)
  const [authReady, setAuthReady] = useState(false)
  const [authError, setAuthError] = useState('')
  const [source, setSource] = useState<AssessmentSource>('self')
  const [grade, setGrade] = useState<Grade | null>(null)
  const [data, setData] = useState<QuestionsResponse | null>(null)
  const [questionsLoading, setQuestionsLoading] = useState(false)
  const [questionsError, setQuestionsError] = useState('')
  const [answers, setAnswers] = useState<Record<string, number>>({})
  const [result, setResult] = useState<DiagnosisResponse | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [resubmitAfterLogin, setResubmitAfterLogin] = useState(false)
  const [authRedirect, setAuthRedirect] = useState<string | null>(null)

  useEffect(() => {
    void fetchMe()
      .then(me => { if (me !== null) setAccount(me) })
      .catch((error: unknown) => setAuthError(messageOf(error, '无法连接服务端，请稍后重试')))
      .finally(() => setAuthReady(true))
  }, [])

  const signIn = useCallback(
    async (mode: 'login' | 'register', username: string, password: string) => {
      setAccount(await authenticate(mode, username, password))
    },
    [],
  )

  const signOut = useCallback(async () => {
    // 只有服务端确认清了 cookie 才清状态：「以为登出了、其实没有」比登出失败更危险
    await logout()
    setAccount(null)
    setSource('self')
    setGrade(null)
    setData(null)
    setAnswers({})
    setResult(null)
    setSubmitError('')
    setResubmitAfterLogin(false)
    setAuthRedirect(null)
  }, [])

  const startAssessment = useCallback((src: AssessmentSource) => {
    setSource(src)
    setGrade(null)
    setData(null)
    setAnswers({})
    setResult(null)
    setQuestionsError('')
    setSubmitError('')
  }, [])

  const chooseGrade = useCallback(async (g: Grade): Promise<'ok' | 'empty' | 'error'> => {
    setGrade(g)
    setData(null)
    setAnswers({})
    setQuestionsLoading(true)
    setQuestionsError('')
    try {
      const data = await fetchQuestions(g)
      setData(data)
      // 空题目不能进问卷：提交必然撞 400。「有没有题」由 provider 判断，
      // 页面组件在 await 之后读 flow.data 只会拿到上一轮渲染的旧快照
      return data.questions.length > 0 ? 'ok' : 'empty'
    } catch (error) {
      setQuestionsError(messageOf(error, '加载失败'))
      return 'error'
    } finally {
      setQuestionsLoading(false)
    }
  }, [])

  const setAnswer = useCallback((questionId: string, optionIndex: number) => {
    setAnswers(prev => ({ ...prev, [questionId]: optionIndex }))
  }, [])

  const submit = useCallback(async (): Promise<'ok' | 'auth' | 'error'> => {
    if (grade === null) return 'error'
    setSubmitting(true)
    setSubmitError('')
    try {
      setResult(await postDiagnose(answers, grade, source))
      setResubmitAfterLogin(false)
      return 'ok'
    } catch (error) {
      if (error instanceof ApiHttpError && error.status === 401) {
        // 会话在答题中途失效：记住回跳点，登录后自动重提，不重新答题（spec §4.2）
        setResubmitAfterLogin(true)
        setAuthRedirect('/quiz')
        return 'auth'
      }
      setSubmitError(messageOf(error, '诊断失败'))
      return 'error'
    } finally {
      setSubmitting(false)
    }
  }, [answers, grade, source])

  return (
    <FlowContext.Provider
      value={{
        account, authReady, authError, signIn, signOut,
        source, startAssessment,
        grade, data, questionsLoading, questionsError, chooseGrade,
        answers, setAnswer,
        result, submitting, submitError, submit, resubmitAfterLogin,
        authRedirect, setAuthRedirect,
      }}
    >
      {children}
    </FlowContext.Provider>
  )
}

export function useFlow(): FlowValue {
  const value = useContext(FlowContext)
  if (value === null) throw new Error('useFlow 必须在 FlowProvider 内使用')
  return value
}

/** /api/meta 全应用只取一次；失败清掉缓存允许下次重试 */
let metaPromise: Promise<MetaResponse> | null = null

export function loadMeta(): Promise<MetaResponse> {
  metaPromise ??= fetchMeta().catch((error: unknown) => {
    metaPromise = null
    throw error
  })
  return metaPromise
}

export function useMeta(): { meta: MetaResponse | null; error: string } {
  const [meta, setMeta] = useState<MetaResponse | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let cancelled = false
    void loadMeta()
      .then(m => { if (!cancelled) setMeta(m) })
      .catch((e: unknown) => { if (!cancelled) setError(messageOf(e, '加载失败')) })
    return () => { cancelled = true }
  }, [])
  return { meta, error }
}
```

同时新建 `apps/web/src/lib/use-title.ts`：

```ts
import { useEffect } from 'react'

/** 浏览器标签页标题随页面更新（前端重设计 spec §4.1） */
export function useTitle(title: string): void {
  useEffect(() => {
    document.title = title
  }, [title])
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @navi/web test`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/state.tsx apps/web/src/state.test.tsx apps/web/src/lib/use-title.ts
git commit -m "feat(web): FlowProvider——会话、答题流、提交与登录回跳"
```

---

### Task 7: 共享组件（顶栏 / 角标 / 雷达 / 滚动显现）

**Files:**
- Create: `apps/web/src/components/TopBar.tsx`
- Test: `apps/web/src/components/TopBar.test.tsx`
- Create: `apps/web/src/components/StatusBadge.tsx`
- Test: `apps/web/src/components/StatusBadge.test.tsx`
- Create: `apps/web/src/components/ProfileRadar.tsx`
- Create: `apps/web/src/components/Reveal.tsx`

- [ ] **Step 1: 顶栏测试（失败）**

新建 `apps/web/src/components/TopBar.test.tsx`：

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fetchMe, logout } from '../api.js'
import { FlowProvider } from '../state.js'
import { TopBar } from './TopBar.js'

vi.mock('../api.js', () => ({
  fetchMe: vi.fn(),
  logout: vi.fn(),
  authenticate: vi.fn(),
  fetchMeta: vi.fn(),
}))

function renderBar() {
  return render(<FlowProvider><TopBar /></FlowProvider>)
}

beforeEach(() => {
  vi.mocked(logout).mockResolvedValue(undefined)
})

describe('TopBar', () => {
  it('未登录时右侧只有登录入口', async () => {
    vi.mocked(fetchMe).mockResolvedValue(null)
    renderBar()
    expect(await screen.findByRole('link', { name: '登录' })).toBeInTheDocument()
    expect(screen.queryByText('历史')).not.toBeInTheDocument()
  })

  it('已登录时显示历史入口、账号名与登出', async () => {
    vi.mocked(fetchMe).mockResolvedValue({ id: 'u1', username: 'tester' })
    renderBar()
    expect(await screen.findByText('tester')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '历史' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '登出' })).toBeInTheDocument()
  })

  it('登出失败时留在原地并把错误说出来，不假装已登出', async () => {
    vi.mocked(fetchMe).mockResolvedValue({ id: 'u1', username: 'tester' })
    vi.mocked(logout).mockRejectedValue(new Error('登出失败：500'))
    renderBar()
    await userEvent.click(await screen.findByRole('button', { name: '登出' }))
    expect(await screen.findByText('登出失败：500')).toBeInTheDocument()
    expect(screen.getByText('tester')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: 运行确认失败后实现**

Run: `pnpm --filter @navi/web test`（Expected: FAIL）

新建 `apps/web/src/components/TopBar.tsx`：

```tsx
import { useState } from 'react'
import { Link, useLocation } from 'wouter'
import { useFlow } from '../state.js'

export function TopBar() {
  const flow = useFlow()
  const [, navigate] = useLocation()
  const [error, setError] = useState('')

  async function signOut() {
    setError('')
    try {
      await flow.signOut()
      navigate('/')
    } catch (e) {
      setError(e instanceof Error ? e.message : '登出失败，请重试')
    }
  }

  return (
    <header className="sticky top-0 z-10 border-b border-line bg-paper/95 backdrop-blur">
      <div className="mx-auto flex max-w-prose items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-baseline gap-2">
          <span className="font-serif text-[22px] font-black">Navi</span>
          <span className="text-[13px] text-ink-2">大学生生涯规划</span>
        </Link>
        <nav className="flex items-center gap-5 text-[14px]">
          {flow.account !== null ? (
            <>
              <Link href="/history" className="text-ink-2 transition-colors hover:text-accent-deep">历史</Link>
              <span className="text-ink-2">{flow.account.username}</span>
              <button
                type="button"
                className="text-ink-2 transition-colors hover:text-accent-deep"
                onClick={() => void signOut()}
              >
                登出
              </button>
            </>
          ) : (
            <Link href="/auth" className="text-accent-deep">登录</Link>
          )}
        </nav>
      </div>
      {error !== '' && (
        <p className="mx-auto max-w-prose px-6 pb-2 text-[13px] text-bad">{error}</p>
      )}
    </header>
  )
}
```

- [ ] **Step 3: 角标**

新建 `apps/web/src/components/StatusBadge.test.tsx`：

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StatusBadge } from './StatusBadge.js'

describe('StatusBadge（前端重设计 spec §3.6）', () => {
  it('draft 与 review 显示待核实', () => {
    render(<StatusBadge status="draft" />)
    render(<StatusBadge status="review" />)
    expect(screen.getAllByText('待核实')).toHaveLength(2)
  })

  it('verified 不渲染任何角标——已核实是常态，不做正向展示', () => {
    const { container } = render(<StatusBadge status="verified" />)
    expect(container).toBeEmptyDOMElement()
  })
})
```

新建 `apps/web/src/components/StatusBadge.tsx`：

```tsx
export function StatusBadge({ status }: { status: string }) {
  if (status === 'verified') return null
  return <span className="chip border-warn/40 bg-warn-soft text-warn">待核实</span>
}
```

- [ ] **Step 4: 雷达封装与滚动显现**

新建 `apps/web/src/components/ProfileRadar.tsx`：

```tsx
import {
  PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, ResponsiveContainer,
} from 'recharts'
import type { RadarRow } from '../lib/result-math.js'

/**
 * 生涯倾向雷达。rows 只含 7 个画像类指标（result-math 保证）。
 * 传了 ideal 的行会多画一条墨色虚线——「你和这条路」的叠加态（主文档 §9.4）。
 */
export function ProfileRadar({ rows }: { rows: RadarRow[] }) {
  const hasIdeal = rows.some(r => r.ideal !== undefined)
  return (
    <div className="h-[320px] w-full" role="img" aria-label="生涯倾向雷达图">
      <ResponsiveContainer>
        <RadarChart data={rows} cx="50%" cy="50%" outerRadius="70%">
          <PolarGrid stroke="#E6DDD0" />
          <PolarAngleAxis dataKey="name" tick={{ fill: '#6E6459', fontSize: 13 }} />
          <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
          <Radar
            name="你" dataKey="score" stroke="#E05A1F" fill="#E05A1F"
            fillOpacity={0.22} animationDuration={600}
          />
          {hasIdeal && (
            <Radar
              name="理想画像" dataKey="ideal" stroke="#201A14" strokeDasharray="4 3"
              fill="none" animationDuration={600}
            />
          )}
        </RadarChart>
      </ResponsiveContainer>
    </div>
  )
}
```

新建 `apps/web/src/components/Reveal.tsx`：

```tsx
import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'

/** 滚动进入视口时一次性显现（spec §3.4 第 4 条）；reduced-motion 下 CSS 直接常显 */
export function Reveal({ children, className = '' }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (el === null) return
    const observer = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-in')
            observer.unobserve(entry.target)
          }
        }
      },
      { threshold: 0.15 },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return <div ref={ref} className={`reveal ${className}`}>{children}</div>
}
```

- [ ] **Step 5: 运行确认通过**

Run: `pnpm --filter @navi/web test`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/TopBar.tsx apps/web/src/components/TopBar.test.tsx apps/web/src/components/StatusBadge.tsx apps/web/src/components/StatusBadge.test.tsx apps/web/src/components/ProfileRadar.tsx apps/web/src/components/Reveal.tsx
git commit -m "feat(web): 顶栏、待核实角标、雷达封装与滚动显现"
```

---

### Task 8: 知识块渲染器 BlockRenderer

**Files:**
- Create: `apps/web/src/components/BlockRenderer.tsx`
- Test: `apps/web/src/components/BlockRenderer.test.tsx`

- [ ] **Step 1: 写失败测试**

新建 `apps/web/src/components/BlockRenderer.test.tsx`：

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { Block } from '@navi/core'
import { BlockRenderer } from './BlockRenderer.js'

const timelineHtml = `<h2>本学科保研时间线</h2>
<ul>
<li><strong>大一上 · 12月</strong> 四级考试</li>
<li><strong>大一下 · 6月</strong> 六级考试</li>
<li><strong>大二上</strong> 奖学金评定</li>
</ul>`

function block(partial: Partial<Block> & { type: string }): Block {
  return { html: '', raw: '', ...partial }
}

describe('BlockRenderer · 时间线', () => {
  it('逐条渲染，当前年级的首条带「现在」标记', () => {
    render(<BlockRenderer blocks={[block({ type: 'timeline', html: timelineHtml })]} grade="sophomore" />)
    expect(screen.getByText('四级考试')).toBeInTheDocument()
    const now = screen.getByText('现在')
    // 「现在」挂在「大二上」那条上：同一条目内
    expect(now.closest('li')!.textContent).toContain('奖学金评定')
  })

  it('大一进来时「现在」落在第一条', () => {
    render(<BlockRenderer blocks={[block({ type: 'timeline', html: timelineHtml })]} grade="freshman" />)
    expect(screen.getByText('现在').closest('li')!.textContent).toContain('四级考试')
  })

  it('没有年级（直接进入详情页）时不显示「现在」', () => {
    render(<BlockRenderer blocks={[block({ type: 'timeline', html: timelineHtml })]} grade={null} />)
    expect(screen.queryByText('现在')).not.toBeInTheDocument()
  })

  it('时间线无 li 可解析时降级为富文本，页面不崩', () => {
    render(<BlockRenderer blocks={[block({ type: 'timeline', html: '<p>一段话</p>' })]} grade="freshman" />)
    expect(screen.getByText('一段话')).toBeInTheDocument()
  })
})

describe('BlockRenderer · 行动指南', () => {
  it('strong 前缀作为时段列，其余作为行动列', () => {
    render(
      <BlockRenderer
        blocks={[block({ type: 'guide', title: '分时段行动建议', html: '<ul><li><strong>大一上</strong> 读懂推免办法</li></ul>' })]}
        grade={null}
      />,
    )
    expect(screen.getByText('分时段行动建议')).toBeInTheDocument()
    expect(screen.getByText('大一上')).toBeInTheDocument()
    expect(screen.getByText('读懂推免办法')).toBeInTheDocument()
  })
})

describe('BlockRenderer · 语义芯片与降级', () => {
  it('误区/代价/风险各带语义芯片', () => {
    render(
      <BlockRenderer
        blocks={[
          block({ type: 'myth', title: '排名前 10% 就稳了', html: '<p>纠正</p>' }),
          block({ type: 'cost', title: '需要放弃', html: '<ul><li>一些东西</li></ul>' }),
          block({ type: 'risk', title: '这条路的风险', html: '<ul><li>一个风险</li></ul>' }),
        ]}
        grade={null}
      />,
    )
    expect(screen.getByText('误区')).toBeInTheDocument()
    expect(screen.getByText('代价')).toBeInTheDocument()
    expect(screen.getByText('风险')).toBeInTheDocument()
  })

  it('未识别块类型降级为富文本渲染（硬性约束 3）', () => {
    render(
      <BlockRenderer
        blocks={[block({ type: 'brand-new-type', title: '新块', html: '<p>照常显示</p>' })]}
        grade={null}
      />,
    )
    expect(screen.getByText('照常显示')).toBeInTheDocument()
    expect(screen.getByText('新块')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @navi/web test`
Expected: FAIL——模块不存在。

- [ ] **Step 3: 实现**

新建 `apps/web/src/components/BlockRenderer.tsx`：

```tsx
import { useMemo } from 'react'
import type { Block } from '@navi/core'
import type { Grade } from '../api.js'

/**
 * 知识块渲染（前端重设计 spec §6）。
 * 块内 HTML 是自有编译器的产物，属可信内容，直接 dangerouslySetInnerHTML，
 * 用作用域 CSS（.kb）统一排版；不引 sanitizer。
 * 时间线与行动指南需要结构，用 DOMParser 拆 <li> 里的 <strong> 前缀。
 */

const CHIP_STYLES: Record<string, { label: string; className: string }> = {
  timeline: { label: '时间线', className: 'border-line bg-paper text-ink-2' },
  guide: { label: '行动指南', className: 'border-ok/30 bg-ok-soft text-ok' },
  myth: { label: '误区', className: 'border-warn/30 bg-warn-soft text-warn' },
  cost: { label: '代价', className: 'border-line bg-paper text-ink' },
  risk: { label: '风险', className: 'border-bad/25 bg-bad-soft text-bad' },
  compare: { label: '对比', className: 'border-line bg-paper text-ink-2' },
  boundary: { label: '诚实边界', className: 'border-line bg-paper text-ink-2' },
}

const NEUTRAL_CHIP = 'border-line bg-paper text-ink-2'

const GRADE_WORDS: Record<Grade, string> = {
  freshman: '大一', sophomore: '大二', junior: '大三', senior: '大四',
}

interface ListItem {
  label: string
  text: string
}

/** 拆 <ul><li><strong>前缀</strong> 正文</li>；拆不出（无 li）返回 null 走富文本降级 */
function parseListItems(html: string): ListItem[] | null {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const items = [...doc.querySelectorAll('li')]
  if (items.length === 0) return null
  return items.map(li => {
    const strong = li.querySelector('strong')
    const label = strong?.textContent?.trim() ?? ''
    const text = (li.textContent ?? '')
      .replace(strong?.textContent ?? '', '')
      .replace(/^[\s·]+/, '')
      .trim()
    return { label, text }
  })
}

function parsedTitle(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  return doc.querySelector('h2')?.textContent?.trim() ?? ''
}

function RichText({ html, className = '' }: { html: string; className?: string }) {
  return <div className={`kb ${className}`} dangerouslySetInnerHTML={{ __html: html }} />
}

function TimelineBlock({ block, grade }: { block: Block; grade: Grade | null }) {
  const items = useMemo(() => parseListItems(block.html), [block.html])
  if (items === null) return <RichText html={block.html} />

  const word = grade === null ? null : GRADE_WORDS[grade]
  const nowIndex = word === null ? -1 : items.findIndex(item => item.label.includes(word))

  return (
    <ol className="border-l border-line pl-0">
      {items.map((item, index) => (
        <li key={index} className="relative mb-4 pl-6 last:mb-0">
          <span
            className={`absolute -left-[5px] top-[7px] h-[9px] w-[9px] rounded-full ${
              index === nowIndex ? 'bg-accent' : 'border border-line bg-surface'
            }`}
          />
          <div className="flex items-center gap-2">
            <span className="font-num text-[13px] font-medium text-ink-2">{item.label}</span>
            {index === nowIndex && (
              <span className="chip border-accent/30 bg-accent-soft text-accent-deep">现在</span>
            )}
          </div>
          <p className="text-[15px] leading-[1.8]">{item.text}</p>
        </li>
      ))}
    </ol>
  )
}

function GuideBlock({ block }: { block: Block }) {
  const items = useMemo(() => parseListItems(block.html), [block.html])
  if (items === null) return <RichText html={block.html} />
  return (
    <div className="grid gap-2.5">
      {items.map((item, index) => (
        <div key={index} className="grid grid-cols-[92px_1fr] gap-4">
          <span className="font-num text-[13px] font-medium leading-7 text-ink-2">{item.label}</span>
          <p className="text-[15px] leading-[1.8]">{item.text}</p>
        </div>
      ))}
    </div>
  )
}

function BlockContent({ block, grade }: { block: Block; grade: Grade | null }) {
  switch (block.type) {
    case 'timeline':
      return <TimelineBlock block={block} grade={grade} />
    case 'guide':
      return <GuideBlock block={block} />
    case 'cost':
      return <RichText html={block.html} className="kb-cost" />
    case 'risk':
      return <RichText html={block.html} className="kb-risk" />
    default:
      // myth / compare / boundary / free / 未识别类型：富文本排版，页面不崩
      return <RichText html={block.html} />
  }
}

export function BlockRenderer({ blocks, grade }: { blocks: Block[]; grade: Grade | null }) {
  return (
    <div className="space-y-5">
      {blocks.map((block, index) => {
        const chip = CHIP_STYLES[block.type]
        const title = block.title ?? (block.type === 'timeline' ? parsedTitle(block.html) : '')
        return (
          <section key={index} className="panel p-6">
            <header className="mb-4 flex items-center gap-3">
              <span className={`chip ${chip?.className ?? NEUTRAL_CHIP}`}>
                {chip?.label ?? block.type}
              </span>
              {title !== '' && (
                <h3 className="font-serif text-[17px] font-semibold">{title}</h3>
              )}
            </header>
            <BlockContent block={block} grade={grade} />
          </section>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @navi/web test`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/BlockRenderer.tsx apps/web/src/components/BlockRenderer.test.tsx
git commit -m "feat(web): 知识块渲染器——语义芯片、时间线现在标记与富文本降级"
```

---

### Task 9: 解读与追问 InterpretSection

**Files:**
- Create: `apps/web/src/components/InterpretSection.tsx`
- Test: `apps/web/src/components/InterpretSection.test.tsx`
- Test: `apps/web/src/components/InterpretSection.stream.test.tsx`

- [ ] **Step 1: 分支渲染测试（失败）**

新建 `apps/web/src/components/InterpretSection.test.tsx`（沿用旧 PathAssistant 测试的 mock 手法，契约按新 spec 调整）：

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('@ai-sdk/react', () => ({
  useCompletion: vi.fn(),
  useChat: vi.fn(),
}))

import { useChat, useCompletion } from '@ai-sdk/react'
import { fetchChatHistory } from '../api.js'
import { InterpretSection } from './InterpretSection.js'

vi.mock('../api.js', async () => {
  const actual = await vi.importActual<typeof import('../api.js')>('./api.js')
  return { ...actual, fetchChatHistory: vi.fn() }
})

const setMessages = vi.fn()
const sendMessage = vi.fn()

function stub(overrides: {
  completion?: string
  interpreting?: boolean
  interpretError?: Error
  messages?: unknown[]
} = {}) {
  vi.mocked(useCompletion).mockReturnValue({
    completion: overrides.completion ?? '',
    complete: vi.fn(),
    isLoading: overrides.interpreting ?? false,
    error: overrides.interpretError,
  } as never)
  vi.mocked(useChat).mockReturnValue({
    messages: overrides.messages ?? [],
    setMessages,
    sendMessage,
    status: 'ready',
    error: undefined,
  } as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(fetchChatHistory).mockResolvedValue([])
  stub()
})

describe('InterpretSection · 解读', () => {
  it('把记录 id 与路径 id 一起发给后端，并按纯文本流消费', () => {
    render(<InterpretSection assessmentId="a1" pathId="civil-service" />)
    const options = vi.mocked(useCompletion).mock.calls[0]![0] as Record<string, unknown>
    expect(options.body).toMatchObject({ assessmentId: 'a1', pathId: 'civil-service' })
    expect(options.streamProtocol).toBe('text')
  })

  it('传入已有解读时直接渲染、不重新生成（历史详情不重算）', () => {
    const complete = vi.fn()
    vi.mocked(useCompletion).mockReturnValue({
      completion: '', complete, isLoading: false, error: undefined,
    } as never)
    render(<InterpretSection assessmentId="a1" pathId="p1" interpretation="存下来的解读" />)
    expect(screen.getByText('存下来的解读')).toBeInTheDocument()
    expect(complete).not.toHaveBeenCalled()
  })

  it('存下来的解读同样剥离【可以问我】行并给出芯片', () => {
    render(
      <InterpretSection
        assessmentId="a1" pathId="p1"
        interpretation={'解读正文。\n【可以问我】保研率大概多少？'}
      />,
    )
    expect(screen.getByText('解读正文。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '保研率大概多少？' })).toBeInTheDocument()
    expect(screen.queryByText(/【可以问我】/)).not.toBeInTheDocument()
  })

  it('503/无输出时整区隐藏（spec §7.3），而不是显示降级提示', () => {
    stub({ interpretError: new Error('503') })
    const { container } = render(<InterpretSection assessmentId="a1" pathId="p1" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('流中断但已有输出：保留内容并给出「继续生成解读」', () => {
    stub({ completion: '已经写出来的部分', interpretError: new Error('stream broken') })
    render(<InterpretSection assessmentId="a1" pathId="p1" />)
    expect(screen.getByText('已经写出来的部分')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '继续生成解读' })).toBeInTheDocument()
  })

  it('流式中显示光标，建议芯片不提前出现', () => {
    stub({ completion: '正文【可以问我】半截', interpreting: true })
    render(<InterpretSection assessmentId="a1" pathId="p1" />)
    expect(screen.getByText('正文')).toBeInTheDocument()
    expect(screen.queryByText(/半截/)).not.toBeInTheDocument()
  })
})

describe('InterpretSection · 追问', () => {
  it('展示已有对话并可发送', async () => {
    stub({
      messages: [
        { id: 'm1', role: 'user', parts: [{ type: 'text', text: '保研和考研怎么选？' }] },
        { id: 'm2', role: 'assistant', parts: [{ type: 'text', text: '两者时间窗不同。' }] },
      ],
    })
    render(<InterpretSection assessmentId="a1" pathId="p1" />)
    expect(screen.getByText(/保研和考研怎么选？/)).toBeInTheDocument()

    await userEvent.type(screen.getByPlaceholderText(/追问/), '那时间窗是？')
    await userEvent.click(screen.getByRole('button', { name: '发送' }))
    expect(sendMessage).toHaveBeenCalledWith({ text: '那时间窗是？' })
  })

  it('点建议芯片等于把问题发出去', async () => {
    stub({ completion: '正文。\n【可以问我】保研率大概多少？' })
    render(<InterpretSection assessmentId="a1" pathId="p1" />)
    await userEvent.click(await screen.findByRole('button', { name: '保研率大概多少？' }))
    expect(sendMessage).toHaveBeenCalledWith({ text: '保研率大概多少？' })
  })

  it('挂载时拉账号级历史，用更新函数合并，不冲掉在途轮次', async () => {
    vi.mocked(fetchChatHistory).mockResolvedValue([
      { id: 'old', role: 'user', parts: [{ type: 'text', text: '更早的问题' }] },
    ])
    render(<InterpretSection assessmentId="a1" pathId="p1" />)
    await waitFor(() => expect(setMessages).toHaveBeenCalled())

    const updater = setMessages.mock.calls.at(-1)![0] as (prev: unknown[]) => unknown[]
    expect(typeof updater).toBe('function')
    const inFlight = [{ id: 'mine', role: 'user', parts: [{ type: 'text', text: '我刚问的' }] }]
    expect(updater(inFlight)).toEqual([
      { id: 'old', role: 'user', parts: [{ type: 'text', text: '更早的问题' }] },
      { id: 'mine', role: 'user', parts: [{ type: 'text', text: '我刚问的' }] },
    ])
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @navi/web test`
Expected: FAIL——模块不存在。

- [ ] **Step 3: 实现**

新建 `apps/web/src/components/InterpretSection.tsx`：

```tsx
import { useEffect, useMemo } from 'react'
import { useChat, useCompletion } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'
import { buildChatBody, fetchChatHistory } from '../api.js'
import type { ChatMessage } from '../api.js'
import { splitSuggestions } from '../lib/suggestions.js'

interface Props {
  /** 解读锚在这条测评记录上——服务端据此从自己的库取答案 */
  assessmentId: string
  pathId: string
  /** 历史详情带回来的解读。有值就直接显示，不再重新生成 */
  interpretation?: string | null
}

/**
 * 04 个性化解读：流式正文 + 建议问题芯片 + 账号级追问。
 *
 * 解读锚在「本路径」上：换路径由父组件改 key 触发重挂载。追问不同——
 * 它是账号级连续流，换路径、换测评都接着上文，所以历史是读回来的。
 */
export function InterpretSection({ assessmentId, pathId, interpretation }: Props) {
  const hasStored = interpretation !== undefined && interpretation !== null

  const {
    completion, complete, isLoading: interpreting, error: interpretError,
  } = useCompletion({
    api: '/api/interpret',
    // 服务端用 toTextStreamResponse()，响应体是纯文本；默认按事件流解析会让
    // 解读在生成结束后变空白
    streamProtocol: 'text',
    body: { assessmentId, pathId },
  })

  const transport = useMemo(
    () => new DefaultChatTransport({
      api: '/api/chat',
      prepareSendMessagesRequest: ({ messages: sent }) => ({
        body: buildChatBody({ assessmentId, pathId, messages: sent as ChatMessage[] }),
      }),
    }),
    [assessmentId, pathId],
  )
  const {
    messages, setMessages, sendMessage, status, error: chatError,
  } = useChat({ transport })

  useEffect(() => {
    // hook 必须无条件调用，变的只有这个 effect
    if (hasStored) return
    void complete('')
  }, [pathId, hasStored])

  useEffect(() => {
    let cancelled = false
    void fetchChatHistory(assessmentId)
      .then(history => {
        if (cancelled) return
        // 用更新函数而不是覆盖：历史是异步来的，直接覆盖会冲掉用户在等待期已发出的一轮
        setMessages(prev => (prev.length === 0 ? history : [...history, ...prev]))
      })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [assessmentId, setMessages])

  const raw = hasStored ? interpretation : completion
  const streaming = !hasStored && interpreting
  const { body, suggestions } = splitSuggestions(raw ?? '', streaming)

  // 503（缺 DEEPSEEK_API_KEY）在任何输出之前就到：整区隐藏（spec §7.3）。
  // 已有输出的中断不走这里——保留内容 + 「继续生成解读」
  if (!hasStored && interpretError !== undefined && (completion ?? '') === '') return null

  const chatBusy = status === 'submitted' || status === 'streaming'

  function ask(question: string) {
    if (question === '' || chatBusy) return
    sendMessage({ text: question })
  }

  return (
    <section>
      <div className="section-head">
        <span className="section-num">04</span>
        <h2 className="section-title">个性化解读</h2>
      </div>

      <p className="whitespace-pre-wrap text-[15px] leading-[1.9]">
        {body}
        {streaming && <span className="stream-cursor" aria-hidden />}
      </p>

      {suggestions.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {suggestions.map(question => (
            <button
              key={question}
              type="button"
              className="chip border-accent/30 bg-accent-soft text-accent-deep transition-colors hover:border-accent"
              onClick={() => ask(question)}
            >
              {question}
            </button>
          ))}
        </div>
      )}

      {!hasStored && interpretError !== undefined && (completion ?? '') !== '' && (
        <button
          type="button"
          className="chip mt-4 border-line bg-paper text-ink-2 hover:border-accent hover:text-accent-deep"
          onClick={() => void complete('')}
        >
          继续生成解读
        </button>
      )}

      <h3 className="mb-2 mt-8 font-serif text-[17px] font-semibold">追问</h3>
      <p className="mb-3 text-[13px] text-ink-3">最近的对话都在这里，换路径、换一次测评都会接着上文。</p>

      {messages.length > 0 && (
        <ul className="mb-4 space-y-3">
          {messages.map(message => (
            <li key={message.id} className="text-[14px] leading-[1.8]">
              <span className="font-medium">{message.role === 'user' ? '你：' : 'Navi：'}</span>
              <span className="whitespace-pre-wrap">
                {message.parts.flatMap(part => (part.type === 'text' ? [part.text] : [])).join('')}
              </span>
            </li>
          ))}
        </ul>
      )}

      {chatError !== undefined && (
        <p className="mb-2 text-[13px] text-warn">追问暂时不可用，请稍后重试。</p>
      )}

      <form
        className="flex gap-2"
        onSubmit={event => {
          event.preventDefault()
          const form = event.currentTarget
          const input = new FormData(form).get('question')
          const question = typeof input === 'string' ? input.trim() : ''
          if (question === '') return
          ask(question)
          form.reset()
        }}
      >
        <input
          name="question"
          placeholder="就这条路径追问……"
          className="field-input flex-1"
          disabled={chatBusy}
        />
        <button type="submit" className="btn-primary px-5" disabled={chatBusy}>发送</button>
      </form>
    </section>
  )
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @navi/web test`
Expected: PASS。

- [ ] **Step 5: 真实流接缝测试（失败→通过）**

新建 `apps/web/src/components/InterpretSection.stream.test.tsx`——保留真实 hook、只换 fetch，专测客户端流协议与服务端响应格式的接缝（旧 `PathAssistant.stream.test.tsx` 的等价物）：

```tsx
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { InterpretSection } from './InterpretSection.js'

/** /api/interpret 用 toTextStreamResponse()，响应体就是纯文本 */
function textResponse(text: string) {
  return {
    ok: true,
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(text))
        controller.close()
      },
    }),
  }
}

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body, text: async () => '' }
}

function stubFetchByUrl(interpretText: string) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/api/chat/history')) return jsonResponse({ turns: [] })
    return textResponse(interpretText)
  }))
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('InterpretSection 与真实 useCompletion 的接缝', () => {
  it('把后端的纯文本流渲染成解读正文', async () => {
    stubFetchByUrl('保研是时间窗最紧的一条路。')
    render(<InterpretSection assessmentId="a1" pathId="same-discipline-baoyan" />)
    expect(await screen.findByText(/保研是时间窗最紧的一条路/)).toBeInTheDocument()
  })

  it('流结束后把【可以问我】行解析成芯片，标记本身不进正文', async () => {
    stubFetchByUrl('解读正文。\n【可以问我】保研率大概多少？ | 大一该做什么？')
    render(<InterpretSection assessmentId="a1" pathId="same-discipline-baoyan" />)
    expect(await screen.findByRole('button', { name: '保研率大概多少？' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '大一该做什么？' })).toBeInTheDocument()
    expect(screen.queryByText(/【可以问我】/)).not.toBeInTheDocument()
  })
})
```

Run: `pnpm --filter @navi/web test`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/InterpretSection.tsx apps/web/src/components/InterpretSection.test.tsx apps/web/src/components/InterpretSection.stream.test.tsx
git commit -m "feat(web): 解读区——流式正文、建议问题芯片与账号级追问"
```

---

### Task 10: 结果页主体 ResultBody

**Files:**
- Create: `apps/web/src/components/ResultBody.tsx`
- Test: `apps/web/src/components/ResultBody.test.tsx`

- [ ] **Step 1: 写失败测试**

新建 `apps/web/src/components/ResultBody.test.tsx`——旧 `ResultView.test.tsx` 的行为契约在新布局下的重写，外加画像段与差距榜：

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@ai-sdk/react', () => ({ useCompletion: vi.fn(), useChat: vi.fn() }))
vi.mock('./ProfileRadar.js', () => ({ ProfileRadar: () => <div data-testid="radar" /> }))

import { useChat, useCompletion } from '@ai-sdk/react'
import { fetchChatHistory, fetchMeta, fetchPathKnowledge } from '../api.js'
import { ResultBody } from './ResultBody.js'
import type { DiagnosisResult, PathSummary } from '../api.js'

vi.mock('../api.js', async () => {
  const actual = await vi.importActual<typeof import('../api.js')>('../api.js')
  return {
    ...actual,
    fetchChatHistory: vi.fn(),
    fetchMeta: vi.fn(),
    fetchPathKnowledge: vi.fn(),
  }
})

beforeEach(() => {
  vi.mocked(useCompletion).mockImplementation(((options: { body: { pathId: string } }) => ({
    completion: `解读-${options.body.pathId}`,
    complete: vi.fn(), isLoading: false, error: undefined,
  })) as never)
  vi.mocked(useChat).mockReturnValue({
    messages: [], setMessages: vi.fn(), sendMessage: vi.fn(), status: 'ready', error: undefined,
  } as never)
  vi.mocked(fetchChatHistory).mockResolvedValue([])
  vi.mocked(fetchMeta).mockResolvedValue({
    archetypes: [{
      id: 'steady-scholar', name: '稳健学术型', vector: {},
      narrative: { oneLiner: '一句话人设', strengths: ['坐得住'], blindspots: ['起步晚'] },
    }],
    indicators: [{ id: 'academic-interest', name: '学术志趣' }],
  })
  vi.mocked(fetchPathKnowledge).mockResolvedValue({
    path: {
      id: 'same-discipline-baoyan', title: '本学科保研', category: 'academic',
      span: 'same-discipline', status: 'verified', summary: '',
      weights: [{ indicator: 'academic-interest', weight: 1, ideal: 90 }],
      eligibility: [],
    },
    blocks: [],
  })
})

const paths: PathSummary[] = [
  { id: 'same-discipline-baoyan', title: '本学科保研', category: 'academic', span: 'same-discipline', status: 'verified', summary: '摘要一句话' },
  { id: 'civil-service', title: '考公考编 / 选调生', category: 'civil', span: 'same-discipline', status: 'draft', summary: '' },
]

const result: DiagnosisResult = {
  indicators: { 'academic-interest': { score: 75, known: true, consistency: 1, sources: [] } },
  paths: [
    {
      id: 'same-discipline-baoyan', match: 78, confidence: 0.9,
      eligibility: { applicable: true, hardFailures: [], softWarnings: [] },
      contributions: [],
    },
    {
      id: 'civil-service', match: 40, confidence: 0.5,
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

function renderBody(props: Partial<Parameters<typeof ResultBody>[0]> = {}) {
  return render(
    <ResultBody
      result={result} paths={paths} tiedPaths={[]} assessmentId="a1"
      interpretation={null} {...props}
    />,
  )
}

describe('ResultBody · 主推荐（契约延续）', () => {
  it('显示主推荐路径的名称与匹配分', async () => {
    renderBody()
    expect(await screen.findByText('本学科保研')).toBeInTheDocument()
    expect(screen.getByText(/78/)).toBeInTheDocument()
  })

  it('不再显示置信度', () => {
    renderBody()
    expect(screen.queryByText(/置信度/)).not.toBeInTheDocument()
  })

  it('主推荐只取可适用路径：高分但硬性不适用不进主位', () => {
    const topInapplicable: DiagnosisResult = {
      ...result,
      paths: [{ ...result.paths[1]!, match: 95 }, result.paths[0]!],
    }
    renderBody({ result: topInapplicable })
    expect(screen.getByRole('heading', { name: '本学科保研' })).toBeInTheDocument()
  })

  it('待核实角标只出现在非 verified 路径上', async () => {
    renderBody()
    expect((await screen.findAllByText('待核实')).length).toBe(1)
  })

  it('并列路径一并列出，说明差异不在谁更合适', () => {
    renderBody({ tiedPaths: ['same-discipline-baoyan', 'civil-service'] })
    expect(screen.getByText(/对你的分数相同/)).toBeInTheDocument()
  })

  it('其他路径是可点击的行，通往各自详情（spec 差异 #2）', () => {
    renderBody()
    const link = screen.getByRole('link', { name: /考公考编/ })
    expect(link).toHaveAttribute('href', '/path/civil-service')
  })

  it('不适用路径置灰并给出原因', () => {
    renderBody()
    expect(screen.getByText(/你的专业没有对口岗位/)).toBeInTheDocument()
  })

  it('空路径列表时不崩溃', () => {
    expect(() => renderBody({
      result: { indicators: {}, paths: [], archetypes: [] }, paths: [],
    })).not.toThrow()
  })
})

describe('ResultBody · 画像段', () => {
  it('主原型名、亲和度与人设来自 /api/meta', async () => {
    renderBody()
    expect(await screen.findByText('稳健学术型')).toBeInTheDocument()
    expect(screen.getByText(/68%/)).toBeInTheDocument()
    expect(screen.getByText('一句话人设')).toBeInTheDocument()
    expect(screen.getByText('坐得住')).toBeInTheDocument()
    expect(screen.getByText('起步晚')).toBeInTheDocument()
  })
})

describe('ResultBody · 差距榜', () => {
  it('用主推荐路径的理想画像算差距', async () => {
    renderBody()
    expect(await screen.findByText(/你 75 · 理想 90/)).toBeInTheDocument()
  })
})

describe('ResultBody · 全部路径不适用（spec §7.4）', () => {
  const noneApplicable: DiagnosisResult = {
    ...result,
    paths: result.paths.map(p => ({ ...p, match: 0, eligibility: { ...p.eligibility, applicable: false } })),
  }

  it('给出显式态与两个出口，解读区不挂载', () => {
    renderBody({ result: noneApplicable })
    expect(screen.getByText('这一次，没有足够适配的路径')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '重新测评' })).toHaveAttribute('href', '/')
    expect(screen.queryByPlaceholderText(/追问/)).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @navi/web test`
Expected: FAIL——模块不存在。

- [ ] **Step 3: 实现**

新建 `apps/web/src/components/ResultBody.tsx`：

```tsx
import { useEffect, useState } from 'react'
import { Link } from 'wouter'
import type { DiagnosisResult, PathSummary } from '../api.js'
import { fetchPathKnowledge } from '../api.js'
import type { PathKnowledge } from '../api.js'
import { gapRows, mainPathOf, radarRows } from '../lib/result-math.js'
import { useMeta } from '../state.js'
import { InterpretSection } from './InterpretSection.js'
import { ProfileRadar } from './ProfileRadar.js'
import { Reveal } from './Reveal.js'
import { StatusBadge } from './StatusBadge.js'

interface Props {
  result: DiagnosisResult
  paths: PathSummary[]
  tiedPaths: string[]
  assessmentId: string
  /** 历史详情带回来的解读；刚测完为 null，由 InterpretSection 现场生成 */
  interpretation: string | null
}

/** 结果页四段叙事；/result 与 /history/:recordId 共用（数据形状一致） */
export function ResultBody({ result, paths, tiedPaths, assessmentId, interpretation }: Props) {
  const pathById = new Map(paths.map(p => [p.id, p]))
  const main = mainPathOf(result)
  const others = result.paths.filter(p => p.id !== main?.id)
  const { meta } = useMeta()

  const [knowledge, setKnowledge] = useState<PathKnowledge | null>(null)
  useEffect(() => {
    if (main === null) return
    let cancelled = false
    void fetchPathKnowledge(main.id)
      .then(k => { if (!cancelled) setKnowledge(k) })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [main?.id])

  const indicators = meta?.indicators ?? []
  const primary = result.archetypes[0]
  const secondary = result.archetypes[1]
  const primaryDef = meta?.archetypes.find(a => a.id === primary?.id)
  const secondaryDef = meta?.archetypes.find(a => a.id === secondary?.id)

  return (
    <div className="space-y-16">
      {/* 01 你的画像 */}
      <Reveal>
        <section>
          <div className="section-head">
            <span className="section-num">01</span>
            <h2 className="section-title">你的画像</h2>
          </div>
          <div className="grid grid-cols-[minmax(0,5fr)_minmax(0,6fr)] items-center gap-10">
            <ProfileRadar rows={radarRows(result, indicators)} />
            <div>
              {primaryDef !== undefined && primary !== undefined ? (
                <>
                  <div className="flex items-baseline gap-4">
                    <h3 className="font-serif text-[28px] font-black">{primaryDef.name}</h3>
                    <span className="font-num text-[26px] font-semibold text-accent">
                      {Math.round(primary.affinity * 100)}%
                    </span>
                  </div>
                  <p className="mt-2 text-[15px] text-ink-2">{primaryDef.narrative.oneLiner}</p>
                  <div className="mt-4 grid grid-cols-2 gap-6 text-[14px]">
                    <div>
                      <p className="mb-1 text-[13px] text-ink-3">优势</p>
                      <ul className="space-y-1">
                        {primaryDef.narrative.strengths.map(s => <li key={s}>{s}</li>)}
                      </ul>
                    </div>
                    <div>
                      <p className="mb-1 text-[13px] text-ink-3">盲点</p>
                      <ul className="space-y-1">
                        {primaryDef.narrative.blindspots.map(s => <li key={s}>{s}</li>)}
                      </ul>
                    </div>
                  </div>
                  {secondary !== undefined && secondaryDef !== undefined && (
                    <p className="mt-4 text-[13px] text-ink-3">
                      次要倾向：{secondaryDef.name} · {Math.round(secondary.affinity * 100)}%
                    </p>
                  )}
                </>
              ) : (
                <p className="text-[14px] text-ink-3">画像信息整理中……</p>
              )}
            </div>
          </div>
        </section>
      </Reveal>

      {/* 02 主推荐路径 */}
      <Reveal>
        <section>
          <div className="section-head">
            <span className="section-num">02</span>
            <h2 className="section-title">主推荐路径</h2>
          </div>

          {main === null ? (
            <div className="panel p-8 text-center">
              <h3 className="font-serif text-[22px] font-black">这一次，没有足够适配的路径</h3>
              <p className="mx-auto mt-3 max-w-[460px] text-[14px] text-ink-2">
                每条路径都有不成立的前置条件，原因逐条列在下方。先解决这些前置条件，再回来评估——这本身就是有用的信息。
              </p>
              <div className="mt-6 flex justify-center gap-3">
                <a href="#path-list" className="btn-secondary">查看路径列表</a>
                <Link href="/" className="btn-primary">重新测评</Link>
              </div>
            </div>
          ) : (
            <div className="panel border-accent/40 p-8">
              <div className="flex items-baseline justify-between">
                <h3 className="font-serif text-[24px] font-black">
                  {pathById.get(main.id)?.title ?? main.id}
                </h3>
                <StatusBadge status={pathById.get(main.id)?.status ?? 'verified'} />
              </div>
              <p className="mt-2 text-[15px] text-ink-2">{pathById.get(main.id)?.summary}</p>
              <div className="mt-5 flex items-end justify-between">
                <p>
                  <span className="font-num text-[40px] font-semibold leading-none text-accent">
                    {Math.round(main.match)}
                  </span>
                  <span className="ml-2 text-[13px] text-ink-3">匹配分</span>
                </p>
                <Link href={`/path/${main.id}`} className="btn-primary">查看完整真相 →</Link>
              </div>
              {main.eligibility.softWarnings.length > 0 && (
                <ul className="mt-4 space-y-1 text-[13px] text-warn">
                  {main.eligibility.softWarnings.map(f => <li key={f.id}>注意：{f.message}</li>)}
                </ul>
              )}
              {tiedPaths.length > 1 && (
                <p className="mt-4 border-t border-line pt-3 text-[13px] text-ink-2">
                  {tiedPaths.map(id => pathById.get(id)?.title ?? id).join(' 与 ')}
                  对你的分数相同，差异主要在于各自的代价与时间线，而不是谁更合适。
                </p>
              )}
            </div>
          )}

          {others.length > 0 && (
            <ul id="path-list" className="mt-5 space-y-2.5">
              {others.map(path => {
                const summary = pathById.get(path.id)
                const applicable = path.eligibility.applicable
                return (
                  <li key={path.id}>
                    <Link
                      href={`/path/${path.id}`}
                      className={`group flex items-center gap-4 rounded-lg border border-line bg-surface px-5 py-3.5 transition-all hover:-translate-y-px hover:border-accent ${
                        applicable ? '' : 'opacity-55'
                      }`}
                    >
                      <span className="w-40 shrink-0 text-[15px] group-hover:text-accent-deep">
                        {summary?.title ?? path.id}
                      </span>
                      <span className="h-1 flex-1 overflow-hidden rounded bg-line">
                        <span
                          className={`block h-1 ${applicable ? 'bg-ink-3' : 'bg-ink-3/50'}`}
                          style={{ width: `${Math.round(path.match)}%` }}
                        />
                      </span>
                      <span className="font-num w-8 text-right text-[15px]">{Math.round(path.match)}</span>
                      <span className="text-ink-3 transition-colors group-hover:text-accent">›</span>
                    </Link>
                    {!applicable && path.eligibility.hardFailures.length > 0 && (
                      <ul className="mt-1 pl-5 text-[12px] text-ink-3">
                        {path.eligibility.hardFailures.map(f => (
                          <li key={f.id}>不适用：{f.message}</li>
                        ))}
                      </ul>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      </Reveal>

      {/* 03 你和这条路 */}
      {main !== null && knowledge !== null && (
        <Reveal>
          <section>
            <div className="section-head">
              <span className="section-num">03</span>
              <h2 className="section-title">你和这条路</h2>
            </div>
            <div className="grid grid-cols-[minmax(0,5fr)_minmax(0,6fr)] items-center gap-10">
              <ProfileRadar
                rows={radarRows(result, indicators, id =>
                  knowledge.path.weights.find(w => w.indicator === id)?.ideal)}
              />
              <div>
                <p className="mb-4 text-[13px] text-ink-3">
                  差距大的地方不是短板，是接下来值得提前补课的方向。
                </p>
                <ul className="space-y-4">
                  {gapRows(result, indicators, knowledge.path.weights).map(row => (
                    <li key={row.id}>
                      <div className="mb-1 flex items-baseline justify-between text-[14px]">
                        <span>{row.name}</span>
                        <span className="font-num text-[13px] text-ink-2">
                          你 {row.score} · 理想 {row.ideal}
                        </span>
                      </div>
                      <div className="relative h-2 rounded bg-line/60">
                        <div
                          className="absolute inset-y-0 left-0 rounded bg-accent/80"
                          style={{ width: `${row.score}%` }}
                        />
                        <div
                          className="absolute -inset-y-0.5 w-[2px] bg-ink"
                          style={{ left: `${row.ideal}%` }}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </section>
        </Reveal>
      )}

      {/* 04 个性化解读：锚在主推荐路径上；无可适用路径时整块不挂载 */}
      {main !== null && (
        <Reveal>
          <InterpretSection
            key={main.id}
            assessmentId={assessmentId}
            pathId={main.id}
            interpretation={interpretation}
          />
        </Reveal>
      )}
    </div>
  )
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @navi/web test`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/ResultBody.tsx apps/web/src/components/ResultBody.test.tsx
git commit -m "feat(web): 结果页四段叙事——画像、主推荐、差距对比与解读"
```

---

### Task 11: 页面一——首页 / 登录注册 / 年级 / 问卷

**Files:**
- Create: `apps/web/src/pages/HomePage.tsx`、`AuthPage.tsx`、`GradePage.tsx`、`QuizPage.tsx`
- Test: 对应 4 个 `.test.tsx`

- [ ] **Step 1: HomePage**

新建 `apps/web/src/pages/HomePage.tsx`：

```tsx
import { Link, useLocation } from 'wouter'
import { useFlow } from '../state.js'
import { useTitle } from '../lib/use-title.js'
import type { AssessmentSource } from '../api.js'

const STEPS = [
  { num: '01', title: '回答一组问题', text: '按你的年级取题，五题一组，跟着自己的感觉答就好' },
  { num: '02', title: '得到你的倾向', text: '根据你的回答，算出你的生涯倾向，看看七条路径里哪条更适合你' },
  { num: '03', title: '看清路的真相', text: '你想听和不想听的，都摆在你面前' },
]

const PROMISES = [
  { title: '提供参考', text: '为你提供大学路径真相和参考，你的路由你来选择。' },
  { title: '如实相告', text: '没有数据支撑的数字，一个都不写给你看。' },
  { title: '放平心态', text: '路径没有高低，只有适不适合你。' },
]

export function HomePage() {
  useTitle('Navi · 大学生生涯规划')
  const flow = useFlow()
  const [, navigate] = useLocation()

  function start(source: AssessmentSource) {
    flow.startAssessment(source)
    if (flow.account === null) {
      flow.setAuthRedirect('/grade')
      navigate('/auth')
    } else {
      navigate('/grade')
    }
  }

  return (
    <div className="mx-auto max-w-prose px-6">
      <section className="animate-rise pb-20 pt-24 text-center">
        <h1 className="font-serif text-[42px] font-black leading-[1.35]">
          先看清自己，再看清<span className="text-accent">路</span>。
        </h1>
        <p className="mx-auto mt-5 max-w-[520px] text-[16px] text-ink-2">
          回答一组问题，得到你的生涯倾向，讲清路径的信息，并向Navi提问。
        </p>
        <div className="mt-9 flex justify-center gap-4">
          <button type="button" className="btn-primary px-8 py-3 text-[16px]" onClick={() => start('self')}>
            测测自己
          </button>
          <button type="button" className="btn-secondary px-8 py-3 text-[16px]" onClick={() => start('other')}>
            测测别人
          </button>
        </div>
        <p className="mt-5 text-[13px] text-ink-3">约5分钟</p>
      </section>

      <section className="animate-rise border-t border-line py-14" style={{ animationDelay: '60ms' }}>
        <h2 className="mb-8 font-serif text-[19px] font-black">它怎么运作</h2>
        <ol className="space-y-6">
          {STEPS.map(step => (
            <li key={step.num} className="flex items-baseline gap-5 border-b border-line pb-5 last:border-b-0">
              <span className="font-num text-[15px] font-semibold text-accent">{step.num}</span>
              <div>
                <p className="font-serif text-[16px] font-semibold">{step.title}</p>
                <p className="mt-0.5 text-[14px] text-ink-2">{step.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="animate-rise border-t border-line py-14" style={{ animationDelay: '120ms' }}>
        <h2 className="mb-8 font-serif text-[19px] font-black">我们的承诺</h2>
        <ul className="space-y-4">
          {PROMISES.map(item => (
            <li key={item.title} className="flex items-baseline gap-5">
              <span className="w-20 shrink-0 font-serif text-[15px] font-semibold text-accent-deep">
                {item.title}
              </span>
              <span className="text-[15px] text-ink-2">{item.text}</span>
            </li>
          ))}
        </ul>
        <p className="mt-12 text-center text-[13px] text-ink-3">
          也可以先随便看看——<Link href="/path/same-discipline-baoyan" className="text-accent-deep">任一路径的真相</Link>不登录也能读。
        </p>
      </section>
    </div>
  )
}
```

- [ ] **Step 2: AuthPage**

新建 `apps/web/src/pages/AuthPage.tsx`：

```tsx
import { useState } from 'react'
import type { FormEvent } from 'react'
import { useLocation } from 'wouter'
import { useFlow } from '../state.js'
import { useTitle } from '../lib/use-title.js'

/** 登录 / 注册同页切换。字段是「账号」——全站不得出现「邮箱」字样（spec 验收 3） */
export function AuthPage() {
  useTitle('登录 · Navi')
  const flow = useFlow()
  const [, navigate] = useLocation()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await flow.signIn(mode, username, password)
      const to = flow.authRedirect ?? '/'
      flow.setAuthRedirect(null)
      navigate(to)
    } catch (e) {
      // 服务端文案原样显示：503 时它说的是「未配置会话密钥」，改写会误导排查
      setError(e instanceof Error ? e.message : '操作失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-[380px] animate-rise px-6 py-20">
      <h1 className="font-serif text-[28px] font-black">{mode === 'login' ? '登录' : '注册'}</h1>
      <p className="mt-2 text-[14px] text-ink-2">
        {mode === 'login' ? '接着上次的进度。' : '创建一个账号，测评与对话都会留存。'}
      </p>

      <form onSubmit={submit} className="mt-8 space-y-4">
        <div>
          <label htmlFor="username" className="mb-1.5 block text-[14px]">账号</label>
          <input
            id="username" name="username" className="field-input" autoComplete="username"
            value={username} onChange={e => setUsername(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="password" className="mb-1.5 block text-[14px]">密码</label>
          <input
            id="password" name="password" type="password" className="field-input"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            value={password} onChange={e => setPassword(e.target.value)}
          />
        </div>
        {error !== '' && <p className="text-[13px] text-bad">{error}</p>}
        <button type="submit" className="btn-primary w-full" disabled={busy}>
          {busy && <span className="spinner" />}
          {mode === 'login' ? '登录' : '注册'}
        </button>
      </form>

      <button
        type="button"
        className="mt-5 text-[13px] text-ink-2 underline underline-offset-4 hover:text-accent-deep"
        onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError('') }}
      >
        {mode === 'login' ? '还没有账号？注册' : '已有账号？登录'}
      </button>
    </div>
  )
}
```

- [ ] **Step 3: GradePage**

新建 `apps/web/src/pages/GradePage.tsx`：

```tsx
import { useState } from 'react'
import { useLocation } from 'wouter'
import { useFlow } from '../state.js'
import { useTitle } from '../lib/use-title.js'
import type { Grade } from '../api.js'

const GRADE_OPTIONS: ReadonlyArray<{ value: Grade; label: string }> = [
  { value: 'freshman', label: '大一' },
  { value: 'sophomore', label: '大二' },
  { value: 'junior', label: '大三' },
  { value: 'senior', label: '大四及以上' },
]

export function GradePage() {
  useTitle('选择年级 · Navi')
  const flow = useFlow()
  const [, navigate] = useLocation()
  const [picking, setPicking] = useState<Grade | null>(null)

  async function pick(value: Grade) {
    setPicking(value)
    const outcome = await flow.chooseGrade(value)
    setPicking(null)
    if (outcome === 'ok') navigate('/quiz')
    // 'empty' 留在本页显示「信息不足」，'error' 显示 questionsError（设计文档 §10）
  }

  const empty = flow.data !== null && flow.data.questions.length === 0

  return (
    <div className="mx-auto max-w-[560px] animate-rise px-6 py-20">
      <h1 className="font-serif text-[28px] font-black">先选择你现在的年级</h1>
      <p className="mt-2 text-[14px] text-ink-2">不同年级看到的题目和判断依据不同。</p>

      <div className="mt-8 space-y-3">
        {GRADE_OPTIONS.map(option => (
          <button
            key={option.value}
            type="button"
            disabled={picking !== null}
            onClick={() => void pick(option.value)}
            className="flex w-full items-center justify-between rounded-lg border border-line bg-surface px-5 py-4 text-left text-[16px] transition-all hover:-translate-y-px hover:border-accent hover:bg-accent-soft/40 disabled:opacity-60"
          >
            {option.label}
            {picking === option.value && <span className="spinner border-accent/30 border-t-accent" />}
          </button>
        ))}
      </div>

      {flow.questionsError !== '' && (
        <div className="mt-6 rounded-lg border border-bad/30 bg-bad-soft p-4 text-[14px] text-bad">
          <p>{flow.questionsError}</p>
          <button
            type="button"
            className="mt-2 underline underline-offset-4"
            onClick={() => { if (flow.grade !== null) void pick(flow.grade) }}
          >
            重试
          </button>
        </div>
      )}

      {empty && (
        <div className="mt-6 rounded-lg border border-line bg-surface p-4 text-[14px] text-ink-2">
          信息不足：当前没有可作答的题目，无法给出推荐。请换一个年级，或稍后再来。
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: QuizPage**

新建 `apps/web/src/pages/QuizPage.tsx`：

```tsx
import { useEffect, useRef, useState } from 'react'
import { Redirect, useLocation } from 'wouter'
import type { Question } from '../api.js'
import { useFlow } from '../state.js'
import { useTitle } from '../lib/use-title.js'

const GROUP_SIZE = 5

/**
 * 作答只存内存（state.tsx），不落 localStorage：按「浏览器」暂存会串账号、
 * 串测评，题面一改还会让旧 id 虚高「已完成」计数。
 */
export function QuizPage() {
  useTitle('问卷 · Navi')
  const flow = useFlow()
  const [, navigate] = useLocation()
  const [page, setPage] = useState(0)
  const questions = flow.data?.questions ?? []

  const groups: Question[][] = []
  for (let i = 0; i < questions.length; i += GROUP_SIZE) {
    groups.push(questions.slice(i, i + GROUP_SIZE))
  }

  const answeredCount = Object.keys(flow.answers).length
  const current = groups[page] ?? []
  const currentComplete = current.every(q => flow.answers[q.id] !== undefined)
  const isLast = page === groups.length - 1
  const allComplete = answeredCount === questions.length

  // 会话在答题中途失效 → 登录后回跳自动重提一次，不重新答题（spec §4.2）
  const resubmitting = useRef(false)
  useEffect(() => {
    if (!flow.resubmitAfterLogin || flow.account === null || flow.submitting) return
    if (resubmitting.current) return
    resubmitting.current = true
    void flow.submit().then(outcome => {
      resubmitting.current = false
      if (outcome === 'ok') navigate('/result')
      else if (outcome === 'auth') navigate('/auth')
    })
  }, [flow.resubmitAfterLogin, flow.account, flow.submitting])

  // 状态守卫：没取过题就直接访问 /quiz（含刷新）时回首页（spec §4.2）。
  // 必须放在全部 hook 之后——守卫前的 hook 每次渲染都要按同样顺序执行
  if (flow.data === null) return <Redirect to="/" />

  async function onSubmit() {
    const outcome = await flow.submit()
    if (outcome === 'ok') navigate('/result')
    else if (outcome === 'auth') navigate('/auth')
  }

  return (
    <div className="mx-auto max-w-[680px] animate-rise px-6 py-14">
      <div className="mb-10">
        <p className="font-num text-[15px] font-semibold text-ink-2">
          {String(answeredCount).padStart(2, '0')} / {questions.length}
        </p>
        <div className="mt-2 h-[2px] w-full bg-line">
          <div
            className="h-[2px] bg-accent transition-all"
            style={{ width: `${questions.length === 0 ? 0 : (answeredCount / questions.length) * 100}%` }}
          />
        </div>
      </div>

      {current.map(question => (
        <fieldset key={question.id} className="mb-10">
          <legend className="mb-4 font-serif text-[18px] font-semibold leading-[1.7]">
            {question.text}
          </legend>
          <div className="space-y-2.5">
            {question.options.map((option, index) => (
              <label key={index} className="block cursor-pointer">
                <input
                  type="radio"
                  name={question.id}
                  className="peer sr-only"
                  checked={flow.answers[question.id] === index}
                  onChange={() => flow.setAnswer(question.id, index)}
                />
                <span
                  className={`block rounded-lg border px-5 py-3 text-[15px] transition-all peer-checked:border-accent peer-checked:bg-accent-soft ${
                    flow.answers[question.id] === index ? '' : 'border-line bg-surface hover:border-ink-3'
                  }`}
                >
                  {option}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      ))}

      {flow.submitError !== '' && (
        <p className="mb-4 rounded-lg border border-bad/30 bg-bad-soft p-3 text-[13px] text-bad">
          {flow.submitError}
        </p>
      )}

      <div className="flex items-center justify-between">
        <button
          type="button"
          className="btn-secondary px-5 py-2 disabled:opacity-40"
          disabled={page === 0}
          onClick={() => setPage(p => p - 1)}
        >
          上一组
        </button>
        {!isLast ? (
          <button
            type="button"
            className="btn-primary px-5 py-2 disabled:opacity-40"
            disabled={!currentComplete}
            onClick={() => setPage(p => p + 1)}
          >
            下一组
          </button>
        ) : (
          <button
            type="button"
            className="btn-primary px-6 py-2 disabled:opacity-40"
            disabled={!allComplete || flow.submitting}
            onClick={() => void onSubmit()}
          >
            {flow.submitting && <span className="spinner" />}
            {flow.submitting ? '正在计算……' : '提交'}
          </button>
        )}
      </div>
    </div>
  )
}

```

- [ ] **Step 5: 页面测试**

页面测试的统一约定：`vi.mock('../api.js')` 用 `importActual` 保留真实实现（`ApiHttpError`、`buildChatBody` 等），只覆盖发请求的函数；会话探测是异步的，需要断言前用探针或 `waitFor` 等 `authReady`；每个用例前把 `window.history` 推回本页路由，避免用例间串路由。

新建 `apps/web/src/pages/HomePage.test.tsx`：

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fetchMe } from '../api.js'
import { FlowProvider, useFlow } from '../state.js'
import { HomePage } from './HomePage.js'

vi.mock('../api.js', async () => {
  const actual = await vi.importActual<typeof import('../api.js')>('../api.js')
  return { ...actual, fetchMe: vi.fn(), authenticate: vi.fn(), logout: vi.fn(), fetchMeta: vi.fn() }
})

/** 会话探测是异步的：点击入口前必须等 authReady，否则登录态判断拿到旧快照 */
function AuthProbe() {
  const { authReady } = useFlow()
  return <span data-testid="auth-ready">{String(authReady)}</span>
}

function renderHome() {
  return render(<FlowProvider><HomePage /><AuthProbe /></FlowProvider>)
}

beforeEach(() => {
  window.history.pushState({}, '', '/')
})

describe('HomePage', () => {
  it('主张、双入口与「约5分钟」', async () => {
    vi.mocked(fetchMe).mockResolvedValue(null)
    renderHome()
    expect(await screen.findByText(/先看清自己，再看清/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '测测自己' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '测测别人' })).toBeInTheDocument()
    expect(screen.getByText('约5分钟')).toBeInTheDocument()
  })

  it('未登录点入口先进登录页（登录门槛，spec §4.2）', async () => {
    vi.mocked(fetchMe).mockResolvedValue(null)
    renderHome()
    await waitFor(() => expect(screen.getByTestId('auth-ready')).toHaveTextContent('true'))
    await userEvent.click(screen.getByRole('button', { name: '测测自己' }))
    expect(window.location.pathname).toBe('/auth')
  })

  it('已登录点入口直接进年级选择', async () => {
    vi.mocked(fetchMe).mockResolvedValue({ id: 'u1', username: 'tester' })
    renderHome()
    await waitFor(() => expect(screen.getByTestId('auth-ready')).toHaveTextContent('true'))
    await userEvent.click(screen.getByRole('button', { name: '测测别人' }))
    expect(window.location.pathname).toBe('/grade')
  })
})
```

新建 `apps/web/src/pages/AuthPage.test.tsx`：

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { authenticate, fetchMe } from '../api.js'
import { FlowProvider } from '../state.js'
import { AuthPage } from './AuthPage.js'

vi.mock('../api.js', async () => {
  const actual = await vi.importActual<typeof import('../api.js')>('../api.js')
  return { ...actual, fetchMe: vi.fn(), authenticate: vi.fn(), logout: vi.fn(), fetchMeta: vi.fn() }
})

function renderAuth() {
  return render(<FlowProvider><AuthPage /></FlowProvider>)
}

beforeEach(() => {
  window.history.pushState({}, '', '/auth')
  vi.mocked(fetchMe).mockResolvedValue(null)
})

describe('AuthPage', () => {
  it('字段是「账号」不是邮箱——全站禁现「邮箱」字样（spec 验收 3）', () => {
    renderAuth()
    expect(screen.getByLabelText('账号')).toBeInTheDocument()
    expect(screen.getByLabelText('密码')).toBeInTheDocument()
    expect(screen.queryByText(/邮箱/)).not.toBeInTheDocument()
  })

  it('登录失败时原样显示服务端文案（契约延续）', async () => {
    vi.mocked(authenticate).mockRejectedValue(new Error('账号或密码不正确'))
    renderAuth()
    await userEvent.type(screen.getByLabelText('账号'), 'tester')
    await userEvent.type(screen.getByLabelText('密码'), 'wrong')
    await userEvent.click(screen.getByRole('button', { name: '登录' }))
    expect(await screen.findByText('账号或密码不正确')).toBeInTheDocument()
  })

  it('503 的服务端文案同样原样显示——它是排查线索，不能泛化（契约延续）', async () => {
    vi.mocked(authenticate).mockRejectedValue(new Error('账号功能暂不可用：服务端未配置会话密钥'))
    renderAuth()
    await userEvent.type(screen.getByLabelText('账号'), 'tester')
    await userEvent.type(screen.getByLabelText('密码'), 'x')
    await userEvent.click(screen.getByRole('button', { name: '登录' }))
    expect(await screen.findByText('账号功能暂不可用：服务端未配置会话密钥')).toBeInTheDocument()
  })

  it('登录成功后跳回回跳点', async () => {
    vi.mocked(authenticate).mockResolvedValue({ id: 'u1', username: 'tester' })
    renderAuth()
    await userEvent.type(screen.getByLabelText('账号'), 'tester')
    await userEvent.type(screen.getByLabelText('密码'), 'secret')
    await userEvent.click(screen.getByRole('button', { name: '登录' }))
    await waitFor(() => expect(window.location.pathname).toBe('/'))
  })

  it('登录与注册同页切换', async () => {
    renderAuth()
    await userEvent.click(screen.getByRole('button', { name: '还没有账号？注册' }))
    expect(screen.getByRole('heading', { name: '注册' })).toBeInTheDocument()
  })
})
```

新建 `apps/web/src/pages/GradePage.test.tsx`：

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fetchMe, fetchQuestions } from '../api.js'
import { FlowProvider } from '../state.js'
import { GradePage } from './GradePage.js'

vi.mock('../api.js', async () => {
  const actual = await vi.importActual<typeof import('../api.js')>('../api.js')
  return {
    ...actual,
    fetchMe: vi.fn(), fetchQuestions: vi.fn(), authenticate: vi.fn(), logout: vi.fn(), fetchMeta: vi.fn(),
  }
})

function renderGrade() {
  return render(<FlowProvider><GradePage /></FlowProvider>)
}

const oneQuestion = {
  questions: [{ id: 'q1', text: 't', options: ['a'], weight: 1 }],
  indicators: [], paths: [],
}

beforeEach(() => {
  window.history.pushState({}, '', '/grade')
  vi.mocked(fetchMe).mockResolvedValue(null)
})

describe('GradePage', () => {
  it('选定年级且题目非空时进入问卷', async () => {
    vi.mocked(fetchQuestions).mockResolvedValue(oneQuestion)
    renderGrade()
    await userEvent.click(await screen.findByRole('button', { name: '大一' }))
    await waitFor(() => expect(window.location.pathname).toBe('/quiz'))
  })

  it('没有可作答题目时显示「信息不足」，不让用户去撞 400（契约延续）', async () => {
    vi.mocked(fetchQuestions).mockResolvedValue({ questions: [], indicators: [], paths: [] })
    renderGrade()
    await userEvent.click(await screen.findByRole('button', { name: '大一' }))
    expect(await screen.findByText(/信息不足/)).toBeInTheDocument()
    expect(window.location.pathname).toBe('/grade')
  })

  it('取题失败时内联错误，重试成功后照常进入问卷', async () => {
    vi.mocked(fetchQuestions).mockRejectedValueOnce(new Error('获取问卷失败：500'))
    renderGrade()
    await userEvent.click(await screen.findByRole('button', { name: '大一' }))
    expect(await screen.findByText('获取问卷失败：500')).toBeInTheDocument()

    vi.mocked(fetchQuestions).mockResolvedValueOnce(oneQuestion)
    await userEvent.click(screen.getByRole('button', { name: '重试' }))
    await waitFor(() => expect(window.location.pathname).toBe('/quiz'))
  })
})
```

新建 `apps/web/src/pages/QuizPage.test.tsx`：

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fetchMe, fetchQuestions, postDiagnose } from '../api.js'
import { ApiHttpError } from '../api.js'
import { FlowProvider, useFlow } from '../state.js'
import { QuizPage } from './QuizPage.js'

vi.mock('../api.js', async () => {
  const actual = await vi.importActual<typeof import('../api.js')>('../api.js')
  return {
    ...actual,
    fetchMe: vi.fn(), fetchQuestions: vi.fn(), postDiagnose: vi.fn(),
    authenticate: vi.fn(), logout: vi.fn(), fetchMeta: vi.fn(),
  }
})

// 6 题 = 两组（5 + 1），覆盖「上一组 / 下一组」与组间必答门槛
const questions = Array.from({ length: 6 }, (_, i) => ({
  id: `q${i + 1}`, text: `题目${i + 1}`, options: ['甲', '乙'], weight: 1,
}))

/** 问卷页只读 state 里的题目——测试用这个探针先把题目装进去 */
function LoadProbe() {
  const flow = useFlow()
  return (
    <button type="button" onClick={() => void flow.chooseGrade('freshman')}>装填题目</button>
  )
}

function renderQuiz() {
  return render(<FlowProvider><QuizPage /><LoadProbe /></FlowProvider>)
}

async function setupQuiz() {
  vi.mocked(fetchQuestions).mockResolvedValue({ questions, indicators: [], paths: [] })
  renderQuiz()
  await userEvent.click(await screen.findByRole('button', { name: '装填题目' }))
  await screen.findByText('题目1')
}

beforeEach(() => {
  window.history.pushState({}, '', '/quiz')
  vi.mocked(fetchMe).mockResolvedValue({ id: 'u1', username: 'tester' })
  vi.mocked(postDiagnose).mockResolvedValue({
    indicators: {}, paths: [], archetypes: [], tiedPaths: [], assessmentId: 'a1',
  })
})

describe('QuizPage', () => {
  it('没有答题上下文直接访问 /quiz 时回首页（状态守卫，spec §4.2）', async () => {
    renderQuiz()
    await waitFor(() => expect(window.location.pathname).toBe('/'))
  })

  it('本组未答满不能前进，答满才能下一组（契约延续）', async () => {
    await setupQuiz()
    const next = screen.getByRole('button', { name: '下一组' })
    expect(next).toBeDisabled()
    for (let i = 0; i < 5; i++) {
      await userEvent.click(screen.getAllByText('甲')[i]!)
    }
    expect(next).toBeEnabled()
  })

  it('全部答完后提交，回传选项索引并进入结果页（契约延续）', async () => {
    await setupQuiz()
    for (let i = 0; i < 5; i++) {
      await userEvent.click(screen.getAllByText('甲')[i]!)
    }
    await userEvent.click(screen.getByRole('button', { name: '下一组' }))
    await userEvent.click(screen.getByText('乙'))
    await userEvent.click(screen.getByRole('button', { name: '提交' }))
    await waitFor(() => expect(window.location.pathname).toBe('/result'))
    expect(vi.mocked(postDiagnose)).toHaveBeenCalledWith(
      { q1: 0, q2: 0, q3: 0, q4: 0, q5: 0, q6: 1 }, 'freshman', 'self',
    )
  })

  it('提交撞 401（会话中途失效）去登录，不重新答题（spec §4.2）', async () => {
    await setupQuiz()
    vi.mocked(postDiagnose).mockRejectedValue(new ApiHttpError('未登录', 401))
    for (let i = 0; i < 5; i++) {
      await userEvent.click(screen.getAllByText('甲')[i]!)
    }
    await userEvent.click(screen.getByRole('button', { name: '下一组' }))
    await userEvent.click(screen.getByText('乙'))
    await userEvent.click(screen.getByRole('button', { name: '提交' }))
    await waitFor(() => expect(window.location.pathname).toBe('/auth'))
  })
})
```

- [ ] **Step 6: 运行确认通过**

Run: `pnpm --filter @navi/web test`
Expected: PASS。

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/pages/HomePage.tsx apps/web/src/pages/HomePage.test.tsx apps/web/src/pages/AuthPage.tsx apps/web/src/pages/AuthPage.test.tsx apps/web/src/pages/GradePage.tsx apps/web/src/pages/GradePage.test.tsx apps/web/src/pages/QuizPage.tsx apps/web/src/pages/QuizPage.test.tsx
git commit -m "feat(web): 首页、登录注册、年级选择与问卷页"
```

---

### Task 12: 页面二——结果页与路径详情

**Files:**
- Create: `apps/web/src/pages/ResultPage.tsx`、`PathDetailPage.tsx`
- Test: 对应 2 个 `.test.tsx`

两个都是薄壳：结果页把内存里的结果交给 `ResultBody`；路径详情按 `:pathId` 取知识交给 `BlockRenderer`。

- [ ] **Step 1: ResultPage**

新建 `apps/web/src/pages/ResultPage.tsx`：

```tsx
import { Redirect } from 'wouter'
import { ResultBody } from '../components/ResultBody.js'
import { useTitle } from '../lib/use-title.js'
import { useFlow } from '../state.js'

const SOURCE_LABELS: Record<string, string> = { self: '测测自己', other: '测测别人' }

/** 结果只存内存：直接访问或刷新后没有上下文就回首页（spec §4.2） */
export function ResultPage() {
  useTitle('测评结果 · Navi')
  const flow = useFlow()
  if (flow.result === null || flow.data === null) return <Redirect to="/" />

  return (
    <div className="mx-auto max-w-prose animate-rise px-6 py-14">
      <header className="mb-12">
        <p className="font-num text-[13px] font-medium tracking-wide text-ink-3">
          {SOURCE_LABELS[flow.source]}
        </p>
        <h1 className="mt-1 font-serif text-[34px] font-black leading-[1.3]">你的结果</h1>
      </header>
      <ResultBody
        result={flow.result}
        paths={flow.data.paths}
        tiedPaths={flow.result.tiedPaths}
        assessmentId={flow.result.assessmentId}
        interpretation={null}
      />
    </div>
  )
}
```

- [ ] **Step 2: PathDetailPage**

新建 `apps/web/src/pages/PathDetailPage.tsx`：

```tsx
import { useEffect, useState } from 'react'
import { Link } from 'wouter'
import { fetchPathKnowledge } from '../api.js'
import type { PathKnowledge } from '../api.js'
import { BlockRenderer } from '../components/BlockRenderer.js'
import { StatusBadge } from '../components/StatusBadge.js'
import { useTitle } from '../lib/use-title.js'
import { useFlow } from '../state.js'

/** 路径详情：免登录可直达（spec §4.1）；匹配分只在有结果上下文时显示（§5.6） */
export function PathDetailPage({ pathId }: { pathId: string }) {
  const flow = useFlow()
  const [knowledge, setKnowledge] = useState<PathKnowledge | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    void fetchPathKnowledge(pathId)
      .then(k => { if (!cancelled) setKnowledge(k) })
      .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : '加载失败') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [pathId, reloadKey])

  // 浏览器标题 =「{路径名}-详情」（spec §4.1）；数据未到前先给通用标题
  useTitle(knowledge === null ? '路径详情 · Navi' : `${knowledge.path.title}-详情`)

  const backTo = flow.result !== null ? '/result' : '/'
  const backLabel = flow.result !== null ? '回到结果' : '回到首页'
  const match = flow.result?.paths.find(p => p.id === pathId)

  if (loading) {
    return (
      <div className="mx-auto max-w-prose px-6 py-14">
        <div className="skeleton h-4 w-24" />
        <div className="mt-6 skeleton h-9 w-64" />
        <div className="mt-4 skeleton h-4 w-full" />
        <div className="mt-3 skeleton h-4 w-5/6" />
        <div className="mt-10 skeleton h-44 w-full rounded-panel" />
      </div>
    )
  }

  if (error !== '' || knowledge === null) {
    return (
      <div className="mx-auto max-w-prose animate-rise px-6 py-20 text-center">
        <h1 className="font-serif text-[24px] font-black">这条路径暂时打不开</h1>
        {error !== '' && <p className="mt-3 text-[14px] text-ink-2">{error}</p>}
        <div className="mt-6 flex justify-center gap-3">
          <button type="button" className="btn-primary" onClick={() => setReloadKey(k => k + 1)}>
            重试
          </button>
          <Link href={backTo} className="btn-secondary">← {backLabel}</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-prose animate-rise px-6 py-14">
      <Link href={backTo} className="text-[14px] text-ink-2 transition-colors hover:text-accent-deep">
        ← {backLabel}
      </Link>
      <header className="mt-6">
        <div className="flex items-baseline gap-3">
          <h1 className="font-serif text-[34px] font-black leading-[1.3]">{knowledge.path.title}</h1>
          <StatusBadge status={knowledge.path.status} />
        </div>
        {match !== undefined && (
          <p className="mt-3">
            <span className="font-num text-[28px] font-semibold leading-none text-accent">
              {Math.round(match.match)}
            </span>
            <span className="ml-2 text-[13px] text-ink-3">匹配分</span>
          </p>
        )}
      </header>
      {knowledge.path.summary !== '' && (
        <p className="mt-6 text-[16px] text-ink-2">{knowledge.path.summary}</p>
      )}
      <div className="mt-10">
        <BlockRenderer blocks={knowledge.blocks} grade={flow.grade} />
      </div>
    </div>
  )
}
```

「← 回到结果」不依赖浏览器回退（spec §4.2）：有结果上下文回 `/result`，直达（如首页底部入口）时回首页，链接文案随之变化。

- [ ] **Step 3: ResultPage 测试**

新建 `apps/web/src/pages/ResultPage.test.tsx`：

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fetchMe, fetchQuestions, postDiagnose } from '../api.js'
import { FlowProvider, useFlow } from '../state.js'
import { ResultPage } from './ResultPage.js'

vi.mock('../api.js', async () => {
  const actual = await vi.importActual<typeof import('../api.js')>('../api.js')
  return {
    ...actual,
    fetchMe: vi.fn(), fetchQuestions: vi.fn(), postDiagnose: vi.fn(),
    authenticate: vi.fn(), logout: vi.fn(), fetchMeta: vi.fn(),
  }
})

// ResultBody 已有自己的测试——这里只验证页面把正确的数据交给它
vi.mock('../components/ResultBody.js', () => ({
  ResultBody: ({ assessmentId }: { assessmentId: string }) => (
    <div data-testid="result-body">{assessmentId}</div>
  ),
}))

/** 结果页只读 state 里的结果——探针负责把「选年级 → 提交」走一遍 */
function RunProbe() {
  const flow = useFlow()
  async function run() {
    await flow.chooseGrade('freshman')
    await flow.submit()
  }
  return <button type="button" onClick={() => void run()}>走一遍流程</button>
}

beforeEach(() => {
  window.history.pushState({}, '', '/result')
  vi.mocked(fetchMe).mockResolvedValue({ id: 'u1', username: 'tester' })
  vi.mocked(fetchQuestions).mockResolvedValue({
    questions: [{ id: 'q1', text: 't', options: ['a'], weight: 1 }],
    indicators: [], paths: [],
  })
  vi.mocked(postDiagnose).mockResolvedValue({
    indicators: {}, paths: [], archetypes: [], tiedPaths: [], assessmentId: 'a1',
  })
})

describe('ResultPage', () => {
  it('没有结果时回首页——结果只存内存，刷新即失效（spec §4.2）', async () => {
    render(<FlowProvider><ResultPage /></FlowProvider>)
    await waitFor(() => expect(window.location.pathname).toBe('/'))
  })

  it('有结果时把记录交给 ResultBody', async () => {
    render(<FlowProvider><ResultPage /><RunProbe /></FlowProvider>)
    await userEvent.click(await screen.findByRole('button', { name: '走一遍流程' }))
    expect(await screen.findByTestId('result-body')).toHaveTextContent('a1')
  })
})
```

- [ ] **Step 4: PathDetailPage 测试**

新建 `apps/web/src/pages/PathDetailPage.test.tsx`：

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fetchMe, fetchPathKnowledge, fetchQuestions, postDiagnose } from '../api.js'
import { FlowProvider, useFlow } from '../state.js'
import { PathDetailPage } from './PathDetailPage.js'

vi.mock('../api.js', async () => {
  const actual = await vi.importActual<typeof import('../api.js')>('../api.js')
  return {
    ...actual,
    fetchMe: vi.fn(), fetchPathKnowledge: vi.fn(), fetchQuestions: vi.fn(), postDiagnose: vi.fn(),
    authenticate: vi.fn(), logout: vi.fn(), fetchMeta: vi.fn(),
  }
})

// BlockRenderer 已有自己的测试——这里只验证块被如数交下
vi.mock('../components/BlockRenderer.js', () => ({
  BlockRenderer: ({ blocks }: { blocks: unknown[] }) => (
    <div data-testid="blocks">{blocks.length} 个块</div>
  ),
}))

const knowledge = {
  path: {
    id: 'same-discipline-baoyan', title: '本学科保研', category: 'academic',
    span: 'same-discipline', status: 'draft', summary: '摘要一句话',
    weights: [], eligibility: [],
  },
  blocks: [{ type: 'timeline', title: '', html: '', raw: '' }],
}

function renderPage() {
  return render(<FlowProvider><PathDetailPage pathId="same-discipline-baoyan" /></FlowProvider>)
}

/** 从结果页进详情的场景：探针把流程走一遍，让 state 里有结果 */
function RunProbe() {
  const flow = useFlow()
  async function run() {
    await flow.chooseGrade('freshman')
    await flow.submit()
  }
  return <button type="button" onClick={() => void run()}>走一遍流程</button>
}

beforeEach(() => {
  window.history.pushState({}, '', '/path/same-discipline-baoyan')
  vi.mocked(fetchMe).mockResolvedValue(null)
  vi.mocked(fetchPathKnowledge).mockResolvedValue(knowledge)
})

describe('PathDetailPage', () => {
  it('标题、摘要与知识块；浏览器标题为「{路径名}-详情」（spec §4.1）', async () => {
    renderPage()
    expect(await screen.findByRole('heading', { name: '本学科保研' })).toBeInTheDocument()
    expect(screen.getByText('摘要一句话')).toBeInTheDocument()
    expect(screen.getByTestId('blocks')).toHaveTextContent('1 个块')
    await waitFor(() => expect(document.title).toBe('本学科保研-详情'))
  })

  it('draft 路径带待核实角标（spec §3.6）', async () => {
    renderPage()
    expect(await screen.findByText('待核实')).toBeInTheDocument()
  })

  it('直达（无结果上下文）时没有匹配分，返回链接指向首页', async () => {
    renderPage()
    await screen.findByRole('heading', { name: '本学科保研' })
    expect(screen.queryByText('匹配分')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /回到首页/ })).toHaveAttribute('href', '/')
  })

  it('从结果页进来时带上匹配分，返回链接指向结果页', async () => {
    vi.mocked(fetchQuestions).mockResolvedValue({
      questions: [{ id: 'q1', text: 't', options: ['a'], weight: 1 }],
      indicators: [], paths: [],
    })
    vi.mocked(postDiagnose).mockResolvedValue({
      indicators: {}, archetypes: [], tiedPaths: [], assessmentId: 'a1',
      paths: [{
        id: 'same-discipline-baoyan', match: 78, confidence: 0.9,
        eligibility: { applicable: true, hardFailures: [], softWarnings: [] },
        contributions: [],
      }],
    })
    render(<FlowProvider><PathDetailPage pathId="same-discipline-baoyan" /><RunProbe /></FlowProvider>)
    await userEvent.click(await screen.findByRole('button', { name: '走一遍流程' }))
    expect(await screen.findByText('78')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /回到结果/ })).toHaveAttribute('href', '/result')
  })

  it('加载中显示暖纸色骨架屏（spec §7.1）', () => {
    vi.mocked(fetchPathKnowledge).mockReturnValue(new Promise<PathKnowledge>(() => {}))
    const { container } = renderPage()
    expect(container.querySelector('.skeleton')).not.toBeNull()
  })

  it('加载失败时内联错误并可重试（不弹框，spec §7.2）', async () => {
    vi.mocked(fetchPathKnowledge).mockRejectedValueOnce(new Error('路径不存在：nope'))
    renderPage()
    expect(await screen.findByText('路径不存在：nope')).toBeInTheDocument()
    vi.mocked(fetchPathKnowledge).mockResolvedValueOnce(knowledge)
    await userEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(await screen.findByRole('heading', { name: '本学科保研' })).toBeInTheDocument()
  })
})
```

（`PathKnowledge` 类型需从 `'../api.js'` 以 `import type` 引入，供骨架屏用例的 `new Promise<PathKnowledge>` 使用。）

- [ ] **Step 5: 运行确认通过**

Run: `pnpm --filter @navi/web test`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/ResultPage.tsx apps/web/src/pages/ResultPage.test.tsx apps/web/src/pages/PathDetailPage.tsx apps/web/src/pages/PathDetailPage.test.tsx
git commit -m "feat(web): 结果页与路径详情页——状态守卫、匹配分上下文与加载/错误态"
```

---

### Task 13: 页面三——历史列表与详情

**Files:**
- Create: `apps/web/src/pages/HistoryPage.tsx`、`HistoryDetailPage.tsx`
- Test: 对应 2 个 `.test.tsx`

列表页取 `/api/assessments` 画行；详情页按 `:recordId` 取一次记录快照，交给与结果页共用的 `ResultBody`（spec §5.7）。两页都要登录（spec §4.1）：会话探测确认前只给骨架，确认未登录才去 `/auth`。

- [ ] **Step 1: 写失败测试**

新建 `apps/web/src/pages/HistoryPage.test.tsx`——旧 `History.test.tsx` 的契约（空态 / 错误态 / 点行进详情）在新布局下的重写，外加守卫与元信息降级：

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fetchAssessments, fetchMe } from '../api.js'
import type { Account, AssessmentSummary } from '../api.js'
import { FlowProvider } from '../state.js'
import { HistoryPage } from './HistoryPage.js'

vi.mock('../api.js', async () => {
  const actual = await vi.importActual<typeof import('../api.js')>('../api.js')
  return {
    ...actual,
    fetchMe: vi.fn(), fetchAssessments: vi.fn(),
    authenticate: vi.fn(), logout: vi.fn(), fetchMeta: vi.fn(),
  }
})

const rows: AssessmentSummary[] = [
  {
    id: 'a1', source: 'self', grade: 'freshman', createdAt: '2026-10-06T08:30:00.000Z',
    mainPathId: 'same-discipline-baoyan', mainPathTitle: '本学科保研', match: 78,
    archetypeName: '稳健学术型',
  },
  {
    id: 'a2', source: 'other', grade: null, createdAt: '2026-09-01T08:30:00.000Z',
    mainPathId: null, mainPathTitle: null, match: null, archetypeName: null,
  },
]

function renderPage() {
  return render(<FlowProvider><HistoryPage /></FlowProvider>)
}

beforeEach(() => {
  window.history.pushState({}, '', '/history')
  vi.mocked(fetchMe).mockResolvedValue({ id: 'u1', username: 'tester' })
  vi.mocked(fetchAssessments).mockResolvedValue(rows)
})

describe('HistoryPage', () => {
  it('未登录访问 /history 时引导登录（spec §4.1）', async () => {
    vi.mocked(fetchMe).mockResolvedValue(null)
    renderPage()
    await waitFor(() => expect(window.location.pathname).toBe('/auth'))
    expect(fetchAssessments).not.toHaveBeenCalled()
  })

  it('会话探测未完成时只显示骨架、不跳转（spec §4.1）', () => {
    vi.mocked(fetchMe).mockReturnValue(new Promise<Account | null>(() => {}))
    const { container } = renderPage()
    expect(container.querySelector('.skeleton')).not.toBeNull()
    expect(window.location.pathname).toBe('/history')
  })

  it('列表行：日期块、主推荐标题、元信息行与匹配分（spec §5.7）', async () => {
    renderPage()
    const link = await screen.findByRole('link', { name: /本学科保研/ })
    expect(link).toHaveAttribute('href', '/history/a1')
    expect(screen.getByText('6')).toBeInTheDocument()
    expect(link).toHaveTextContent('2026 · 10')
    expect(link).toHaveTextContent('测测自己 · 大一 · 稳健学术型')
    expect(link).toHaveTextContent('78')
    await waitFor(() => expect(document.title).toBe('历史 · Navi'))
  })

  it('字段缺失时如实降级：无主推荐、元信息只剩来源、不显示分数（spec §5.7）', async () => {
    renderPage()
    const link = await screen.findByRole('link', { name: /无主推荐/ })
    expect(link).toHaveAttribute('href', '/history/a2')
    expect(link).toHaveTextContent('测测别人')
    expect(link).not.toHaveTextContent('测测别人 ·')
    expect(link).not.toHaveTextContent('78')
  })

  it('空态文案与去做测评入口（spec §5.7）', async () => {
    vi.mocked(fetchAssessments).mockResolvedValue([])
    renderPage()
    expect(await screen.findByText('还没有记录')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '做一次测评' })).toHaveAttribute('href', '/')
  })

  it('列表加载中显示暖纸色骨架屏（spec §7.1）', async () => {
    vi.mocked(fetchAssessments).mockReturnValue(new Promise<AssessmentSummary[]>(() => {}))
    const { container } = renderPage()
    await screen.findByRole('heading', { name: '你的历史' })
    expect(container.querySelector('.skeleton')).not.toBeNull()
  })

  it('列表取失败时内联错误并可重试（不弹框，spec §7.2）', async () => {
    vi.mocked(fetchAssessments).mockRejectedValueOnce(new Error('获取历史失败：500'))
    renderPage()
    expect(await screen.findByText('获取历史失败：500')).toBeInTheDocument()
    vi.mocked(fetchAssessments).mockResolvedValueOnce(rows)
    await userEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(await screen.findByRole('link', { name: /本学科保研/ })).toBeInTheDocument()
  })
})
```

（`Account` / `AssessmentSummary` 类型需从 `'../api.js'` 以 `import type` 引入，供永不 resolve 的骨架屏用例使用；fixture 里的 `archetypeName` 是 Task 2 给 `AssessmentSummary` 追加的字段。）

新建 `apps/web/src/pages/HistoryDetailPage.test.tsx`：

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fetchAssessment, fetchMe } from '../api.js'
import type { AssessmentDetail } from '../api.js'
import { FlowProvider } from '../state.js'
import { HistoryDetailPage } from './HistoryDetailPage.js'

vi.mock('../api.js', async () => {
  const actual = await vi.importActual<typeof import('../api.js')>('../api.js')
  return {
    ...actual,
    fetchMe: vi.fn(), fetchAssessment: vi.fn(),
    authenticate: vi.fn(), logout: vi.fn(), fetchMeta: vi.fn(),
  }
})

// ResultBody 已有自己的测试——这里只验证页面把记录快照原样交下去
vi.mock('../components/ResultBody.js', () => ({
  ResultBody: ({ assessmentId, paths, tiedPaths, interpretation }: {
    assessmentId: string
    paths: unknown[]
    tiedPaths: string[]
    interpretation: string | null
  }) => (
    <div data-testid="result-body">
      {assessmentId} · {paths.length} 条路径 · {tiedPaths.length} 并列 · {interpretation ?? '无解读'}
    </div>
  ),
}))

const detail: AssessmentDetail = {
  id: 'a1', source: 'self', grade: 'freshman', createdAt: '2026-10-06T08:30:00.000Z',
  answers: { q1: 0 },
  result: { indicators: {}, paths: [], archetypes: [] },
  interpretation: '这一段解读原样带回',
  mainPathId: 'same-discipline-baoyan',
  tiedPaths: ['civil-service'],
  paths: [
    {
      id: 'same-discipline-baoyan', title: '本学科保研', category: 'academic',
      span: 'same-discipline', status: 'verified', summary: '',
    },
    {
      id: 'civil-service', title: '考公考编 / 选调生', category: 'civil',
      span: 'same-discipline', status: 'draft', summary: '',
    },
  ],
}

function renderPage() {
  return render(<FlowProvider><HistoryDetailPage recordId="a1" /></FlowProvider>)
}

beforeEach(() => {
  window.history.pushState({}, '', '/history/a1')
  vi.mocked(fetchMe).mockResolvedValue({ id: 'u1', username: 'tester' })
  vi.mocked(fetchAssessment).mockResolvedValue(detail)
})

describe('HistoryDetailPage', () => {
  it('未登录访问记录详情时引导登录（spec §4.1）', async () => {
    vi.mocked(fetchMe).mockResolvedValue(null)
    renderPage()
    await waitFor(() => expect(window.location.pathname).toBe('/auth'))
    expect(fetchAssessment).not.toHaveBeenCalled()
  })

  it('顶部回到历史链接、页头日期与来源（spec §5.7）', async () => {
    renderPage()
    expect(await screen.findByRole('link', { name: /回到历史/ })).toHaveAttribute('href', '/history')
    expect(screen.getByText(/2026年10月6日 · 测测自己/)).toBeInTheDocument()
    await waitFor(() => expect(document.title).toBe('测评记录 · Navi'))
  })

  it('把记录快照原样交给 ResultBody（spec §5.7）', async () => {
    renderPage()
    expect(await screen.findByTestId('result-body'))
      .toHaveTextContent('a1 · 2 条路径 · 1 并列 · 这一段解读原样带回')
  })

  it('加载中显示暖纸色骨架屏（spec §7.1）', async () => {
    vi.mocked(fetchAssessment).mockReturnValue(new Promise<AssessmentDetail>(() => {}))
    const { container } = renderPage()
    await waitFor(() => expect(fetchAssessment).toHaveBeenCalledWith('a1'))
    expect(container.querySelector('.skeleton')).not.toBeNull()
  })

  it('加载失败时内联错误并可重试与返回（不弹框，spec §7.2）', async () => {
    vi.mocked(fetchAssessment).mockRejectedValueOnce(new Error('记录不存在：nope'))
    renderPage()
    expect(await screen.findByText('记录不存在：nope')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /回到历史/ })).toHaveAttribute('href', '/history')
    vi.mocked(fetchAssessment).mockResolvedValueOnce(detail)
    await userEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(await screen.findByTestId('result-body')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @navi/web test`
Expected: FAIL——模块不存在。

- [ ] **Step 3: 实现**

新建 `apps/web/src/pages/HistoryPage.tsx`：

```tsx
import { useEffect, useState } from 'react'
import { Link, Redirect } from 'wouter'
import { fetchAssessments } from '../api.js'
import type { AssessmentSummary } from '../api.js'
import { useTitle } from '../lib/use-title.js'
import { useFlow } from '../state.js'

const SOURCE_LABELS: Record<string, string> = { self: '测测自己', other: '测测别人' }

// 与 GradePage 的 GRADE_OPTIONS 同一份文案；只在这一行元信息里用，不抽共享模块
const GRADE_LABELS: Record<string, string> = {
  freshman: '大一', sophomore: '大二', junior: '大三', senior: '大四及以上',
}

/** 元信息行：来源 · 年级 · 画像名，缺谁省略谁（spec §5.7） */
function metaOf(row: AssessmentSummary): string {
  const grade = row.grade === null ? undefined : GRADE_LABELS[row.grade]
  return [SOURCE_LABELS[row.source], grade, row.archetypeName]
    .filter((part): part is string => part !== undefined && part !== '')
    .join(' · ')
}

export function HistoryPage() {
  useTitle('历史 · Navi')
  const { authReady, account, setAuthRedirect } = useFlow()
  const [rows, setRows] = useState<AssessmentSummary[] | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)

  const loggedIn = authReady && account !== null

  useEffect(() => {
    // 未登录会被送去 /auth；先记下回跳点，登录成功后回历史页而不是首页
    if (authReady && account === null) setAuthRedirect('/history')
  }, [authReady, account, setAuthRedirect])

  useEffect(() => {
    if (!loggedIn) return
    let cancelled = false
    setLoading(true)
    setError('')
    void fetchAssessments()
      .then(list => { if (!cancelled) setRows(list) })
      .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : '加载失败') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [loggedIn, reloadKey])

  // 会话探测是异步的：登录态确认前不跳转，先给骨架，否则会把已登录用户误送去 /auth
  if (!authReady) {
    return (
      <div className="mx-auto max-w-prose px-6 py-14">
        <div className="skeleton h-9 w-40" />
        <div className="mt-3 skeleton h-4 w-64" />
        <div className="mt-10 skeleton h-16 w-full rounded-panel" />
        <div className="mt-3 skeleton h-16 w-full rounded-panel" />
      </div>
    )
  }

  if (account === null) return <Redirect to="/auth" />

  return (
    <div className="mx-auto max-w-prose animate-rise px-6 py-14">
      <header>
        <h1 className="font-serif text-[34px] font-black leading-[1.3]">你的历史</h1>
        <p className="mt-2 text-[14px] text-ink-2">每一次测评都留在这里，随时回看。</p>
      </header>

      {loading ? (
        <ul className="mt-8 space-y-2.5">
          {[0, 1, 2].map(i => (
            <li key={i} className="flex items-center gap-5 rounded-lg border border-line bg-surface px-5 py-4">
              <span className="skeleton h-10 w-14 shrink-0" />
              <span className="flex-1 space-y-2">
                <span className="skeleton block h-4 w-40" />
                <span className="skeleton block h-3 w-56" />
              </span>
              <span className="skeleton h-5 w-8 shrink-0" />
            </li>
          ))}
        </ul>
      ) : error !== '' ? (
        <div className="mt-8 rounded-panel border border-line bg-surface p-8 text-center">
          <p className="text-[15px]">{error}</p>
          <button type="button" className="btn-primary mt-5" onClick={() => setReloadKey(k => k + 1)}>
            重试
          </button>
        </div>
      ) : rows !== null && rows.length === 0 ? (
        <div className="mt-8 rounded-panel border border-line bg-surface p-10 text-center">
          <p className="font-serif text-[19px] font-black">还没有记录</p>
          <Link href="/" className="btn-primary mt-5 inline-block">做一次测评</Link>
        </div>
      ) : (
        <ul className="mt-8 space-y-2.5">
          {(rows ?? []).map(row => {
            const d = new Date(row.createdAt)
            return (
              <li key={row.id}>
                <Link
                  href={`/history/${row.id}`}
                  className="group flex items-center gap-5 rounded-lg border border-line bg-surface px-5 py-4 transition-all hover:-translate-y-px hover:border-accent"
                >
                  <span className="w-14 shrink-0 text-center">
                    <span className="font-num block text-[26px] font-semibold leading-none">
                      {d.getDate()}
                    </span>
                    <span className="mt-1 block text-[12px] text-ink-3">
                      {d.getFullYear()} · {d.getMonth() + 1}
                    </span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-medium transition-colors group-hover:text-accent-deep">
                      {row.mainPathTitle ?? '无主推荐'}
                    </span>
                    <span className="mt-0.5 block truncate text-[13px] text-ink-3">{metaOf(row)}</span>
                  </span>
                  {row.match !== null && (
                    <span className="font-num shrink-0 text-[17px] font-semibold text-accent">
                      {Math.round(row.match)}
                    </span>
                  )}
                  <span className="text-ink-3 transition-colors group-hover:text-accent">›</span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
```

守卫顺序是「先等会话探测，再决定跳转」：`authReady` 为 false 时只渲染骨架——探测是异步的，抢跑会把已登录用户误送去 `/auth`；确认未登录时先经 `setAuthRedirect` 记下回跳点再走，登录成功后回历史页而不是被 AuthPage 默认带去首页。行内布局与结果页「其他路径行」同气质：`group` 悬停、右侧 `›`。

新建 `apps/web/src/pages/HistoryDetailPage.tsx`：

```tsx
import { useEffect, useState } from 'react'
import { Link, Redirect } from 'wouter'
import { fetchAssessment } from '../api.js'
import type { AssessmentDetail } from '../api.js'
import { ResultBody } from '../components/ResultBody.js'
import { useTitle } from '../lib/use-title.js'
import { useFlow } from '../state.js'

const SOURCE_LABELS: Record<string, string> = { self: '测测自己', other: '测测别人' }

function formatDate(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
}

function PageSkeleton() {
  return (
    <div className="mx-auto max-w-prose px-6 py-14">
      <div className="skeleton h-4 w-24" />
      <div className="mt-6 skeleton h-9 w-64" />
      <div className="mt-4 skeleton h-4 w-full" />
      <div className="mt-3 skeleton h-4 w-5/6" />
      <div className="mt-10 skeleton h-44 w-full rounded-panel" />
    </div>
  )
}

/** 历史详情 = 结果页视图 + 记录快照（spec §5.7）：数据形状一致，一次请求取全 */
export function HistoryDetailPage({ recordId }: { recordId: string }) {
  useTitle('测评记录 · Navi')
  const { authReady, account, setAuthRedirect } = useFlow()
  const [detail, setDetail] = useState<AssessmentDetail | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)

  const loggedIn = authReady && account !== null

  useEffect(() => {
    // 未登录会被送去 /auth；记下回跳点，登录成功后回到正在看的这条记录
    if (authReady && account === null) setAuthRedirect(`/history/${recordId}`)
  }, [authReady, account, recordId, setAuthRedirect])

  useEffect(() => {
    if (!loggedIn) return
    let cancelled = false
    setLoading(true)
    setError('')
    void fetchAssessment(recordId)
      .then(d => { if (!cancelled) setDetail(d) })
      .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : '加载失败') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [recordId, loggedIn, reloadKey])

  if (!authReady) return <PageSkeleton />

  if (account === null) return <Redirect to="/auth" />

  if (loading) return <PageSkeleton />

  if (error !== '' || detail === null) {
    return (
      <div className="mx-auto max-w-prose animate-rise px-6 py-20 text-center">
        <h1 className="font-serif text-[24px] font-black">这条记录暂时打不开</h1>
        {error !== '' && <p className="mt-3 text-[14px] text-ink-2">{error}</p>}
        <div className="mt-6 flex justify-center gap-3">
          <button type="button" className="btn-primary" onClick={() => setReloadKey(k => k + 1)}>
            重试
          </button>
          <Link href="/history" className="btn-secondary">← 回到历史</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-prose animate-rise px-6 py-14">
      <Link href="/history" className="text-[14px] text-ink-2 transition-colors hover:text-accent-deep">
        ← 回到历史
      </Link>
      <header className="mb-12 mt-6">
        <p className="font-num text-[13px] font-medium tracking-wide text-ink-3">
          {formatDate(detail.createdAt)} · {SOURCE_LABELS[detail.source]}
        </p>
        <h1 className="mt-1 font-serif text-[34px] font-black leading-[1.3]">测评记录</h1>
      </header>
      <ResultBody
        result={detail.result}
        paths={detail.paths}
        tiedPaths={detail.tiedPaths}
        assessmentId={detail.id}
        interpretation={detail.interpretation}
      />
    </div>
  )
}
```

解读随记录快照带回（`detail.interpretation`），`ResultBody` 直接渲染、不重新生成——现场生成是 `/result` 的事。错误态与 `PathDetailPage` 同构：标题 + 原样错误文案 + 重试 + 返回链接。

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @navi/web test`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/HistoryPage.tsx apps/web/src/pages/HistoryPage.test.tsx apps/web/src/pages/HistoryDetailPage.tsx apps/web/src/pages/HistoryDetailPage.test.tsx
git commit -m "feat(web): 历史列表与详情页——登录守卫、记录元信息与快照复用结果视图"
```

---

### Task 14: 路由外壳与旧组件清理

**Files:**
- Rewrite: `apps/web/src/App.tsx`
- Rewrite: `apps/web/src/App.test.tsx`
- Delete: `apps/web/src/components/{History,Login,PathAssistant,Questionnaire,ResultView}.tsx` 及其 6 个测试（共 11 个文件）

App 只留两样东西：`<FlowProvider>` + `<TopBar />` 的全局外壳，与 spec §4.1 的 8 条路由表。状态守卫（`/quiz`、`/result` 无上下文回首页）与路由过渡（`animate-rise`）都已在各页面组件内（Task 11–12），App 不重复任何判断与动画。

本任务是全计划的收尾：做完之后 `apps/web` 不再残留任何旧状态机代码，前端重设计全部落地。

- [ ] **Step 1: 写失败测试（整体重写 App.test.tsx）**

旧 `App.test.tsx` 整体替换、不做修补：它钉住的行为契约（服务端文案原样透出、登出仅成功才清状态、信息不足显式态等）已按计划开头的「必须延续的行为契约」表，由 `state.test.tsx`、`TopBar.test.tsx`、`pages/GradePage.test.tsx`、`pages/AuthPage.test.tsx` 等承接，这里只留路由冒烟。mock `../api.js` 沿用各页面测试的 `importActual` 模式。

整体重写 `apps/web/src/App.test.tsx`。用例直接渲染 `<App />`——外壳（`FlowProvider`）由 App 自带，测试不再包一层；位置用 `window.history.pushState` 置入，与各页面测试一致。冒烟只断言路由接线：`/history` 的未登录引导等页面内守卫属于 Task 13 页面自己的测试范围，不在这里重复。

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { fetchMe, fetchPathKnowledge } from '../api.js'
import { App } from './App.js'

vi.mock('../api.js', async () => {
  const actual = await vi.importActual<typeof import('../api.js')>('../api.js')
  return {
    ...actual,
    fetchMe: vi.fn(), fetchQuestions: vi.fn(), postDiagnose: vi.fn(),
    authenticate: vi.fn(), logout: vi.fn(), fetchMeta: vi.fn(), fetchPathKnowledge: vi.fn(),
  }
})

beforeEach(() => {
  vi.mocked(fetchMe).mockResolvedValue(null)
})

describe('App 路由外壳', () => {
  it('/ 渲染首页与顶栏', async () => {
    window.history.pushState({}, '', '/')
    render(<App />)
    expect(await screen.findByRole('heading', { name: /先看清自己，再看清路/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Navi/ })).toHaveAttribute('href', '/')
  })

  it('未知路由重定向回首页——兜底不给 404 态', async () => {
    window.history.pushState({}, '', '/no-such-route')
    render(<App />)
    await waitFor(() => expect(window.location.pathname).toBe('/'))
    expect(await screen.findByRole('heading', { name: /先看清自己，再看清路/ })).toBeInTheDocument()
  })

  it('/path/:pathId 把路由参数交给路径详情页', async () => {
    vi.mocked(fetchPathKnowledge).mockResolvedValue({
      path: {
        id: 'same-discipline-baoyan', title: '本学科保研', category: 'academic',
        span: 'same-discipline', status: 'verified', summary: '',
        weights: [], eligibility: [],
      },
      blocks: [],
    })
    window.history.pushState({}, '', '/path/same-discipline-baoyan')
    render(<App />)
    expect(await screen.findByRole('heading', { name: '本学科保研' })).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @navi/web test`
Expected: FAIL——此时 `App.tsx` 还是旧状态机，`/` 渲染的是旧 `Login`，找不到首页标题。只有新 `App.test.tsx` 失败，其余套件（各页面、组件、state）应照常绿；若有别的套件跟着红，说明前面的任务有回退，先查那个。

- [ ] **Step 3: 实现 App.tsx（整体重写）**

整体重写 `apps/web/src/App.tsx`：

```tsx
import { Redirect, Route, Switch } from 'wouter'
import { TopBar } from './components/TopBar.js'
import { AuthPage } from './pages/AuthPage.js'
import { GradePage } from './pages/GradePage.js'
import { HistoryDetailPage } from './pages/HistoryDetailPage.js'
import { HistoryPage } from './pages/HistoryPage.js'
import { HomePage } from './pages/HomePage.js'
import { PathDetailPage } from './pages/PathDetailPage.js'
import { QuizPage } from './pages/QuizPage.js'
import { ResultPage } from './pages/ResultPage.js'
import { FlowProvider } from './state.js'

/** App 只有全局外壳：会话上下文 + 顶栏 + 路由表。守卫与过渡动画都在页面内，这里不重复 */
export function App() {
  return (
    <FlowProvider>
      <TopBar />
      <Switch>
        <Route path="/" component={HomePage} />
        <Route path="/auth" component={AuthPage} />
        <Route path="/grade" component={GradePage} />
        <Route path="/quiz" component={QuizPage} />
        <Route path="/result" component={ResultPage} />
        <Route path="/path/:pathId">
          {params => <PathDetailPage pathId={params.pathId} />}
        </Route>
        <Route path="/history" component={HistoryPage} />
        <Route path="/history/:recordId">
          {params => <HistoryDetailPage recordId={params.recordId} />}
        </Route>
        {/* 兜底：未知路由一律回首页 */}
        <Route>
          <Redirect to="/" />
        </Route>
      </Switch>
    </FlowProvider>
  )
}
```

要点：

- 8 条路由对应 spec §4.1 路由表；除两个详情页外，页面组件全部无 prop（Task 11–13 契约）：`PathDetailPage` 接收 `pathId`，`HistoryDetailPage` 接收 `recordId`，两者对称，路由参数在 `<Route>` 的 children 函数里取出传入。
- `<TopBar />` 放在 `<Switch>` 之外：它是全站常驻的全局元素，不随路由切换重渲染。
- 必须用 `<Switch>`：只渲染第一条匹配的路由，否则无 path 的兜底 `<Route>` 会与每个页面同时渲染。
- 不再包 `<Router>`：wouter 默认用浏览器 history，测试用 `window.history.pushState` 置位置，与各页面测试一致。
- App 里没有 `if`、没有状态读取：守卫逻辑（无上下文回首页、未登录引导 `/auth`）都在各页面与 `state.tsx` 里，这里多写一行判断就是重复。
- 生产部署需要 SPA fallback（history API，spec §4.3）；vite dev 默认满足，部署平台侧的配置不在本任务范围，但验收时要记得这一条。

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @navi/web test`
Expected: PASS。此时旧组件文件还在磁盘上但已无人引用（它们的测试也还在跑且照旧绿），Step 6 统一删除。

- [ ] **Step 5: main.tsx 字体导入（条件步骤）**

已在 Task 1 Step 4 完成，本步跳过。只需确认 `apps/web/src/main.tsx` 顶部、`import { App }` 之前已有四行 `@fontsource` 导入（`noto-serif-sc/600.css`、`noto-serif-sc/900.css`、`fraunces/500.css`、`fraunces/600.css`）。

若确认时发现缺失（说明 Task 1 未按计划执行），先按 Task 1 Step 4 原样补上再继续，不要在本任务里改写形式。

- [ ] **Step 6: 删除旧组件**

```bash
git rm apps/web/src/components/History.tsx apps/web/src/components/History.test.tsx apps/web/src/components/Login.tsx apps/web/src/components/Login.test.tsx apps/web/src/components/PathAssistant.tsx apps/web/src/components/PathAssistant.test.tsx apps/web/src/components/PathAssistant.stream.test.tsx apps/web/src/components/Questionnaire.tsx apps/web/src/components/Questionnaire.test.tsx apps/web/src/components/ResultView.tsx apps/web/src/components/ResultView.test.tsx
```

即 `components/` 下全部 11 个旧文件：

- `History.tsx`、`History.test.tsx`
- `Login.tsx`、`Login.test.tsx`
- `PathAssistant.tsx`、`PathAssistant.test.tsx`、`PathAssistant.stream.test.tsx`
- `Questionnaire.tsx`、`Questionnaire.test.tsx`
- `ResultView.tsx`、`ResultView.test.tsx`

删除没有顺序风险：① 新 `App.tsx` 已在 Step 3 整体重写，不再 import 其中任何一个；② Task 1–13 新建的文件只依赖 `api.js` / `state.js` / `lib/` 与新组件，没有任何一处引用旧组件；③ 所以先删再全量验证不会引入新破坏。删完可自查：`rg "components/(History|Login|PathAssistant|Questionnaire|ResultView)" apps/web/src` 应无命中。

删除不损失任何行为保证：旧测试钉住的契约已按开头「必须延续的行为契约」表逐一迁移——`PathAssistant.stream.test.tsx` 的纯文本流消费在 `components/InterpretSection.stream.test.tsx`，`History.test.tsx` 的空态 / 错误态 / 点行回传在 `pages/HistoryPage.test.tsx`，`ResultView.test.tsx` 的主推荐规则在 `components/ResultBody.test.tsx`，其余在 `state.test.tsx` 与各页面测试。

`git rm` 会把删除直接暂存，Step 9 的 `-A` 再兜一次底；两条路径都不会漏。

（计划开头「现状快照」与文件结构表里「Task 13 统一删除」的写法是排期调整前的旧文案，删除统一在本任务执行。）

- [ ] **Step 7: 全量验证**

此前每个任务只跑 `@navi/web` 单包，本任务做全仓验证（也是计划开头「Task 14 做全仓验证」的落点）。

Run: `pnpm test`
Expected: 知识库编译 0 告警，全部包测试绿（`pnpm test` 会先编译知识库再跑全部包）。
Run: `pnpm lint`
Expected: 通过。
Run: `pnpm build`
Expected: 通过。

提醒：

- 本轮未动推荐逻辑（`packages/core` 未改），黄金案例集无需变更——`pnpm test` 本身即是回归。
- 本轮未动知识库，编译告警理应为 0；若出现告警，说明有意外改动混入，先排查再继续。

- [ ] **Step 8: 对照 spec §10 验收要点逐条走查**

交付前的最终自查，逐条对照 spec §10：

- [ ] 1. `pnpm build` / `pnpm lint` / `pnpm test` 全绿，知识库编译 0 告警——本任务 Step 7 已执行。
- [ ] 2. 同一学生重复测评结果一致——本计划全程未改 `packages/core`，黄金案例集由 `pnpm test` 中的 core 测试覆盖。
- [ ] 3. 全站无「邮箱」字样（Task 11 AuthPage，字段是「账号」）；无置信度展示（Task 10 ResultBody）；`verified` 内容无角标（Task 7 StatusBadge，Task 12 详情页使用）。
- [ ] 4. 三种降级路径手动验证：未识别块类型降级富文本（Task 8 BlockRenderer）；缺 API Key → 解读 503 整区隐藏（Task 9 InterpretSection）；缺 JWT_SECRET → 503 文案原样透出（Task 6 FlowProvider authError，Task 7 顶栏 / Task 11 AuthPage 显示）。手动验证方式：把 `.env` 对应项留空后 `pnpm dev` 逐一目检。
- [ ] 5. 桌面端（≥1024px）各页面与样张一致（Task 1、11–13 的视觉比对）；`prefers-reduced-motion` 下无动画（Task 1 index.css 媒体查询，系统设置切换后目检）。

任何一条不满足就回对应任务修复，修复后重跑 Step 7 全量验证再来走查；五条全过才算本任务完成。

- [ ] **Step 9: Commit**

此处用 `-A` 的理由：本任务变更只有「替换 2 个文件 + 删除 11 个文件」，清单完全可枚举，不应出现第三类文件；`-A` 保证删除不被漏暂存。提交前先看一眼 `git status`，若出现预期外的文件，停下排查再提交。

```bash
git add -A
git commit -m "feat(web): 切换 wouter 路由外壳，移除旧状态机组件"
```

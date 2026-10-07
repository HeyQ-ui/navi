# 路径总览页（`/paths`）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增免登录的路径总览页 `/paths`：七条路径的可点选入口 + `common.md` 的通用知识（常见误区、横向对比），并把首页那句浏览引导指向它。

**Architecture:** 服务端新增页面级端点 `GET /api/overview`（路径摘要 + 通用知识块，一次取齐，与 `/api/assessments/:id` 自带 `paths` 同一模式）。前端从结果页抽出共享的 `PathRow` 组件（结果页传匹配分与适用性 → 外观不变；浏览页不传 → 不渲染匹配条与分数），新页用 `BlockRenderer` 复用既有块渲染，不新增渲染逻辑。

**Tech Stack:** TypeScript · Hono（apps/api）· React 18 + Vite + TailwindCSS + wouter + vitest/@testing-library（apps/web）

**上游规格:** `docs/superpowers/specs/2026-10-06-navi-frontend-redesign-design.md` §5.8、§8.4、§10 第 6–7 条

---

## 开始之前（执行者必读）

**项目硬约束**（`AGENTS.md` 摘录，与本计划相关者）：

1. `packages/core` 零框架依赖、零网络请求；本计划**不改** `packages/core`，也不改知识库内容。
2. 不得将知识库内容硬编码进 TypeScript 源码——本页的误区与对比表全部来自 `bundle.common`，不许在组件里写死文案。
3. 知识库出现新块类型时不得导致构建失败或内容丢失——本页第 03 节取「`myth` 之外的其余块」而非类型白名单。
4. 提交前 `pnpm test` 与 `pnpm lint` 都要绿；提交信息用中文 Conventional Commits。

**两条环境坑**（`AGENTS.md`）：

- Windows PowerShell 5：命令串联用 `;`，**不要用 `&&`**（会直接语法报错）。
- `.env` 已在 `.gitignore`；根 `package.json` 可能被 corepack 自动写入 `packageManager` 字段，**不要提交它**——每次提交都用明确列文件名的方式 `git add`。

**本计划涉及的既有契约**（不要改动它们）：

- `PathSummary`（`apps/web/src/api.ts`）= `{ id, title, category, span, status, summary }`。
- `Block`（`@navi/core`，经 `api.ts` 重导出）= `{ type: string; title?: string; html: string; raw: string }`。
- `BlockRenderer`（`apps/web/src/components/BlockRenderer.tsx`）= `({ blocks, grade }: { blocks: Block[]; grade: Grade | null })`。
- `EligibilityFailure` = `{ id, message }`（`api.ts` 重导出）。
- `bundle.common` 已经由知识库编译器产出（`packages/knowledge/src/build.ts` 的 `parseContainers`），**无需改编译器**。

**当前状态**：`apps/web` 全量测试 109 用例绿；`/api` 94 用例绿。每个任务结束时 `pnpm --filter @navi/web test`（或对应包）必须绿。

---

## 文件结构

| 动作 | 文件 | 职责 |
|---|---|---|
| 改 | `apps/api/src/server.ts` | 新增 `GET /api/overview`（`pathSummaries()` 复用，`bundle.common` 原样下发） |
| 改 | `apps/api/src/server.test.ts` | 该端点的契约测试 |
| 改 | `apps/web/src/api.ts` | `OverviewResponse` 类型 + `fetchOverview()` |
| 改 | `apps/web/src/api.test.ts` | `fetchOverview` 的 URL 与解析测试 |
| 新 | `apps/web/src/components/PathRow.tsx` | 路径行（结果态带匹配分/适用性，浏览态不带） |
| 新 | `apps/web/src/components/PathRow.test.tsx` | 两态、角标、不适用置灰 |
| 改 | `apps/web/src/components/ResultBody.tsx` | 「其他路径」列表改用 `PathRow`（外观与行为不变） |
| 新 | `apps/web/src/pages/PathsPage.tsx` | 路径总览页（01 入口 / 02 误区 / 03 对比） |
| 新 | `apps/web/src/pages/PathsPage.test.tsx` | 七行、两段通用内容、骨架、错误重试、浏览态无分数 |
| 改 | `apps/web/src/App.tsx` | 路由表加 `/paths` |
| 改 | `apps/web/src/App.test.tsx` | `/paths` 路由冒烟（顺带把 `fetchOverview` 加进 mock 清单） |
| 改 | `apps/web/src/pages/HomePage.tsx` | 页尾引导改指 `/paths`，链接文案换为「七条路径的真相与对比」 |
| 改 | `apps/web/src/pages/HomePage.test.tsx` | 钉住该链接 |

---

### Task 1: 服务端 `GET /api/overview`

**Files:**
- Modify: `apps/api/src/server.ts`（在 `/api/meta` 路由之后加）
- Test: `apps/api/src/server.test.ts`

- [ ] **Step 1: 写失败测试**

在 `apps/api/src/server.test.ts` 的 `describe('GET /api/meta', …)` 之后追加：

```ts
describe('GET /api/overview', () => {
  const common = [
    { type: 'myth', title: '目标真空、盲目跟风', html: '<p>正文</p>', raw: '目标真空、盲目跟风' },
    { type: 'compare', title: '七条路径差异对比', html: '<table><tr><td>a</td></tr></table>', raw: '七条路径差异对比' },
  ]

  it('免登录返回七条路径摘要与通用知识块，供路径总览页一次取齐', async () => {
    // 不带 cookie：浏览不挡，这是主文档 §9.1 那条「不做诊断直接浏览」的端点
    const res = await createApp({ ...bundle, common }).request('/api/overview')
    expect(res.status).toBe(200)
    const body = await res.json() as {
      paths: Array<Record<string, unknown>>
      common: unknown[]
    }
    expect(body.paths).toHaveLength(bundle.paths.length)
    expect(body.paths[0]).toEqual({
      id: 'same-discipline-baoyan', title: '本学科保研', category: 'academic',
      span: 'same-discipline', status: 'verified', summary: '',
    })
    // 摘要只含摘要：知识块与权重由 /api/knowledge/:pathId 单独提供
    expect(body.paths.some(p => 'weights' in p || 'eligibility' in p || 'blocks' in p)).toBe(false)
    expect(body.common).toEqual(common)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @navi/api test server`
Expected: FAIL——`/api/overview` 落到兜底 404，`res.status` 不是 200。

- [ ] **Step 3: 实现**

在 `apps/api/src/server.ts` 的 `/api/meta` 路由之后加：

```ts
  // 路径总览页（spec §5.8）：不做诊断直接浏览知识库时一次取齐所需的全部数据。
  // 路径摘要与 /api/questions 的 paths 同源；通用知识块来自 common.md 编译产物
  app.get('/api/overview', c => {
    return c.json({ paths: pathSummaries(), common: bundle.common })
  })
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @navi/api test`
Expected: PASS（95 用例）。

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/server.ts apps/api/src/server.test.ts
git commit -m "feat(api): 新增 /api/overview——路径摘要与通用知识块一次取齐"
```

---

### Task 2: 前端 `fetchOverview`

**Files:**
- Modify: `apps/web/src/api.ts`（文件末尾追加）
- Test: `apps/web/src/api.test.ts`

- [ ] **Step 1: 写失败测试**

在 `apps/web/src/api.test.ts` 顶部 import 里补上 `fetchOverview`：

```ts
import { postDiagnose, logout, fetchQuestions, fetchOverview, fetchChatHistory, buildChatBody } from './api.js'
```

并在 `describe('fetchPathKnowledge', …)` 之后追加：

```ts
describe('fetchOverview', () => {
  it('取路径摘要与通用知识块，免登录可调', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ paths: [], common: [] }), { status: 200 }),
    )
    await expect(fetchOverview()).resolves.toEqual({ paths: [], common: [] })
    expect(vi.mocked(globalThis.fetch).mock.calls[0]![0]).toBe('/api/overview')
  })

  it('失败时透出服务端文案', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: '服务维护中' }), { status: 503 }),
    )
    await expect(fetchOverview()).rejects.toThrow('服务维护中')
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @navi/web test api`
Expected: FAIL——`fetchOverview` 未导出。

- [ ] **Step 3: 实现**

在 `apps/web/src/api.ts` 末尾（`fetchPathKnowledge` 之后）追加：

```ts
/** 路径总览页一次取齐的数据：七条路径摘要 + 通用知识块（前端重设计 spec §5.8、§8.4） */
export interface OverviewResponse {
  paths: PathSummary[]
  /** common.md 编译产物：myth（常见误区）与 compare（横向对比）两类块 */
  common: Block[]
}

export async function fetchOverview(): Promise<OverviewResponse> {
  const res = await fetch('/api/overview')
  return (await jsonOrThrow(res, '获取路径总览')) as OverviewResponse
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @navi/web test api`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/api.ts apps/web/src/api.test.ts
git commit -m "feat(web): api 层补 fetchOverview"
```

---

### Task 3: 抽出共享组件 `PathRow`（结果页行为必须不变）

**Files:**
- Create: `apps/web/src/components/PathRow.tsx`
- Test: `apps/web/src/components/PathRow.test.tsx`
- Modify: `apps/web/src/components/ResultBody.tsx`

这是本计划风险最高的一步：抽出的组件同时被结果页复用，**结果页的外观与行为一个字都不许变**，既有 `ResultBody.test.tsx` 是全绿基线，抽完必须仍全绿。

- [ ] **Step 1: 写失败测试**

新建 `apps/web/src/components/PathRow.test.tsx`：

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PathRow } from './PathRow.js'
import type { PathRowData } from './PathRow.js'

function renderRow(data: PathRowData) {
  return render(<ul><PathRow data={data} /></ul>)
}

describe('PathRow', () => {
  it('结果态：渲染匹配条与匹配分，整行指向路径详情', () => {
    const { container } = renderRow({
      id: 'same-discipline-baoyan', title: '本学科保研', status: 'verified',
      match: 78, applicable: true,
    })
    const link = screen.getByRole('link', { name: /本学科保研/ })
    expect(link).toHaveAttribute('href', '/path/same-discipline-baoyan')
    expect(link).toHaveTextContent('78')
    expect(container.querySelector('.bg-ink-3')).not.toBeNull()
  })

  it('浏览态：没有匹配分时不渲染匹配条与分数——不拿空条或 0 分充数（spec §5.8）', () => {
    const { container } = renderRow({
      id: 'same-discipline-baoyan', title: '本学科保研', status: 'verified',
    })
    const link = screen.getByRole('link', { name: '本学科保研' })
    expect(link).toHaveTextContent('本学科保研')
    expect(link.querySelector('.bg-ink-3')).toBeNull()
    expect(container.querySelector('.bg-line')).toBeNull()
  })

  it('draft 路径带待核实角标（spec §3.6）', () => {
    renderRow({ id: 'a', title: '本学科考研', status: 'draft' })
    expect(screen.getByText('待核实')).toBeInTheDocument()
  })

  it('verified 路径不带任何角标（spec §3.6）', () => {
    renderRow({ id: 'a', title: '本学科考研', status: 'verified' })
    expect(screen.queryByText('待核实')).not.toBeInTheDocument()
  })

  it('不适用路径置灰并逐条列出原因（主文档 §7.4）', () => {
    const { container } = renderRow({
      id: 'civil-service', title: '考公考编', status: 'verified',
      match: 12, applicable: false,
      hardFailures: [{ id: 'f1', message: '需要党员身份' }],
    })
    expect(screen.getByText('不适用：需要党员身份')).toBeInTheDocument()
    expect(container.querySelector('.opacity-55')).not.toBeNull()
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @navi/web test PathRow`
Expected: FAIL——`PathRow.js` 不存在。

- [ ] **Step 3: 实现组件**

新建 `apps/web/src/components/PathRow.tsx`：

```tsx
import { Link } from 'wouter'
import type { EligibilityFailure } from '../api.js'
import { StatusBadge } from './StatusBadge.js'

export interface PathRowData {
  id: string
  title: string
  status: string
  /**
   * 匹配分与适用性只有测评上下文才有（结果页）。
   * 路径总览页不做诊断直接浏览，这两项缺席——此时不渲染匹配条与分数，
   * 而不是拿 0 分或空条充数（spec §5.1「没有数据支撑的数字，一个都不写给你看」）。
   */
  match?: number
  applicable?: boolean
  hardFailures?: EligibilityFailure[]
}

/**
 * 一条路径的入口行。渲染 `<li>`，由调用方放进 `<ul>`。
 * 结果页与路径总览页共用（spec §5.5 02 段 / §5.8 01 节）。
 */
export function PathRow({ data }: { data: PathRowData }) {
  const applicable = data.applicable ?? true
  const match = data.match
  const hardFailures = data.hardFailures ?? []

  return (
    <li>
      <Link
        href={`/path/${data.id}`}
        className={`group flex items-center gap-4 rounded-lg border border-line bg-surface px-5 py-3.5 transition-all hover:-translate-y-px hover:border-accent ${
          applicable ? '' : 'opacity-55'
        }`}
      >
        <span className="w-40 shrink-0 text-[15px] group-hover:text-accent-deep">{data.title}</span>
        <StatusBadge status={data.status} />
        {match !== undefined ? (
          <>
            <span className="h-1 flex-1 overflow-hidden rounded bg-line">
              <span
                className={`block h-1 ${applicable ? 'bg-ink-3' : 'bg-ink-3/50'}`}
                style={{ width: `${Math.round(match)}%` }}
              />
            </span>
            <span className="font-num w-8 text-right text-[15px]">{Math.round(match)}</span>
          </>
        ) : (
          // 浏览态没有分数，用弹性空白把 › 顶到行尾，保持与结果页同一版式
          <span className="flex-1" />
        )}
        <span className="text-ink-3 transition-colors group-hover:text-accent">›</span>
      </Link>
      {!applicable && hardFailures.length > 0 && (
        <ul className="mt-1 pl-5 text-[12px] text-ink-3">
          {hardFailures.map(f => <li key={f.id}>不适用：{f.message}</li>)}
        </ul>
      )}
    </li>
  )
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @navi/web test PathRow`
Expected: PASS（5 用例）。

- [ ] **Step 5: 让结果页改用 `PathRow`**

在 `apps/web/src/components/ResultBody.tsx` 里把「其他路径」那段（`{others.length > 0 && (…)}` 里的 `<li>` 结构）整体替换为：

```tsx
          {others.length > 0 && (
            <ul id="path-list" className="mt-5 space-y-2.5">
              {others.map(path => {
                const summary = pathById.get(path.id)
                return (
                  <PathRow
                    key={path.id}
                    data={{
                      id: path.id,
                      title: summary?.title ?? path.id,
                      status: summary?.status ?? 'verified',
                      match: path.match,
                      applicable: path.eligibility.applicable,
                      hardFailures: path.eligibility.hardFailures,
                    }}
                  />
                )
              })}
            </ul>
          )}
```

并在文件顶部 import 区加一行（`StatusBadge` 与 `Link` 仍被主推荐卡使用，**不要删**）：

```tsx
import { PathRow } from './PathRow.js'
```

- [ ] **Step 6: 跑结果页既有测试，确认行为未变**

Run: `pnpm --filter @navi/web test ResultBody`
Expected: PASS——**12 个既有用例一个都不许失败**。`<ul id="path-list">` 这个 id 必须保留：无主推荐那段有一个 `href="#path-list"` 的按钮指向它。

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/PathRow.tsx apps/web/src/components/PathRow.test.tsx apps/web/src/components/ResultBody.tsx
git commit -m "refactor(web): 抽出共享的路径行组件，结果页行为不变"
```

---

### Task 4: 路径总览页 `PathsPage`

**Files:**
- Create: `apps/web/src/pages/PathsPage.tsx`
- Test: `apps/web/src/pages/PathsPage.test.tsx`

- [ ] **Step 1: 写失败测试**

新建 `apps/web/src/pages/PathsPage.test.tsx`：

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fetchOverview } from '../api.js'
import type { OverviewResponse } from '../api.js'
import { PathsPage } from './PathsPage.js'

vi.mock('../api.js', async () => {
  const actual = await vi.importActual<typeof import('../api.js')>('../api.js')
  return { ...actual, fetchOverview: vi.fn(), fetchMe: vi.fn(), fetchMeta: vi.fn() }
})

const overview: OverviewResponse = {
  paths: [
    { id: 'civil-service', title: '考公考编', category: 'public', span: 'civil-service', status: 'verified', summary: '体制内' },
    { id: 'cross-discipline-baoyan', title: '跨学科保研', category: 'academic', span: 'cross-discipline', status: 'draft', summary: '跨专业' },
    { id: 'cross-discipline-job', title: '跨学科就业', category: 'employment', span: 'cross-discipline', status: 'verified', summary: '转行' },
    { id: 'cross-discipline-kaoyan', title: '跨学科考研', category: 'academic', span: 'cross-discipline', status: 'verified', summary: '跨考' },
    { id: 'same-discipline-baoyan', title: '本学科保研', category: 'academic', span: 'same-discipline', status: 'verified', summary: '保研' },
    { id: 'same-discipline-job', title: '本学科就业', category: 'employment', span: 'same-discipline', status: 'verified', summary: '就业' },
    { id: 'same-discipline-kaoyan', title: '本学科考研', category: 'academic', span: 'same-discipline', status: 'verified', summary: '考研' },
  ],
  common: [
    { type: 'myth', title: '目标真空、盲目跟风', html: '<p>随大流决定考研 / 考公 / 保研。</p>', raw: '目标真空、盲目跟风' },
    { type: 'compare', title: '七条路径差异对比', html: '<table><tr><td>竞争性质</td></tr></table>', raw: '七条路径差异对比' },
  ],
}

function renderPage() {
  return render(<PathsPage />)
}

beforeEach(() => {
  window.history.pushState({}, '', '/paths')
  vi.mocked(fetchOverview).mockResolvedValue(overview)
})

describe('PathsPage', () => {
  it('七条路径入口 + 两段通用知识（spec §5.8）', async () => {
    renderPage()
    expect(await screen.findByRole('heading', { name: '七条路径' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '选一条路，看它的真相' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '大一新生常见误区' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '七条路径横向对比' })).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: /保研|考研|考公考编|就业/ })).toHaveLength(7)
    // 通用块按知识库内顺序渲染：误区在前，对比在后
    expect(screen.getByText('目标真空、盲目跟风')).toBeInTheDocument()
    expect(screen.getByText('七条路径差异对比')).toBeInTheDocument()
  })

  it('浏览态不出现匹配条与分数——没有测评就没有这些数（spec §5.8）', async () => {
    const { container } = renderPage()
    await screen.findByRole('heading', { name: '七条路径' })
    expect(container.querySelector('.bg-ink-3')).toBeNull()
    expect(container.querySelector('.bg-line')).toBeNull()
  })

  it('每行指向各自详情页，draft 路径带待核实角标（spec §3.6）', async () => {
    renderPage()
    expect(await screen.findByRole('link', { name: /本学科保研/ }))
      .toHaveAttribute('href', '/path/same-discipline-baoyan')
    expect(screen.getByRole('link', { name: /跨学科保研/ }))
      .toHaveAttribute('href', '/path/cross-discipline-baoyan')
    expect(screen.getByText('待核实')).toBeInTheDocument()
  })

  it('加载中显示暖纸色骨架屏（spec §7.1）', () => {
    vi.mocked(fetchOverview).mockReturnValue(new Promise<OverviewResponse>(() => {}))
    const { container } = renderPage()
    expect(container.querySelector('.skeleton')).not.toBeNull()
  })

  it('加载失败时内联错误并可重试（不弹框，spec §7.2）', async () => {
    vi.mocked(fetchOverview).mockRejectedValueOnce(new Error('获取路径总览失败：500'))
    renderPage()
    expect(await screen.findByText('获取路径总览失败：500')).toBeInTheDocument()
    vi.mocked(fetchOverview).mockResolvedValueOnce(overview)
    await userEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(await screen.findByRole('heading', { name: '七条路径' })).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @navi/web test PathsPage`
Expected: FAIL——`PathsPage.js` 不存在。

- [ ] **Step 3: 实现**

新建 `apps/web/src/pages/PathsPage.tsx`：

```tsx
import { useEffect, useState } from 'react'
import { fetchOverview } from '../api.js'
import type { OverviewResponse } from '../api.js'
import { BlockRenderer } from '../components/BlockRenderer.js'
import { PathRow } from '../components/PathRow.js'
import { useTitle } from '../lib/use-title.js'

/**
 * 路径总览 `/paths`：不做诊断直接浏览知识库的入口（主文档 §9.1）。
 * 数据一次取齐（spec §8.4）——路径摘要 + common.md 的通用知识块。
 */
export function PathsPage() {
  useTitle('七条路径 · Navi')
  const [data, setData] = useState<OverviewResponse | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    void fetchOverview()
      .then(d => { if (!cancelled) setData(d) })
      .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : '加载失败') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [reloadKey])

  if (loading) {
    return (
      <div className="mx-auto max-w-prose px-6 py-14">
        <div className="skeleton h-9 w-48" />
        <div className="mt-3 skeleton h-4 w-72" />
        <div className="mt-12 space-y-2.5">
          {[0, 1, 2, 3, 4, 5, 6].map(i => (
            <div key={i} className="skeleton h-12 w-full rounded-lg" />
          ))}
        </div>
      </div>
    )
  }

  if (error !== '' || data === null) {
    return (
      <div className="mx-auto max-w-prose animate-rise px-6 py-20 text-center">
        <h1 className="font-serif text-[24px] font-black">这会儿打不开路径总览</h1>
        {error !== '' && <p className="mt-3 text-[14px] text-ink-2">{error}</p>}
        <button
          type="button"
          className="btn-primary mt-6"
          onClick={() => setReloadKey(k => k + 1)}
        >
          重试
        </button>
      </div>
    )
  }

  // 误区与其余块分开呈现，但都不做类型白名单：除 myth 之外的一律进第 03 节，
  // 将来 common.md 用了新块类型也不会在这一页被丢掉（硬性约束 3）
  const myths = data.common.filter(block => block.type === 'myth')
  const rest = data.common.filter(block => block.type !== 'myth')

  return (
    <div className="mx-auto max-w-prose animate-rise px-6 py-14">
      <header>
        <h1 className="font-serif text-[34px] font-black leading-[1.3]">七条路径</h1>
        <p className="mt-3 text-[15px] text-ink-2">
          不需要先测评。先看清每条路要付出什么、会在哪里卡住。
        </p>
      </header>

      <section className="mt-12">
        <div className="section-head">
          <span className="section-num">01</span>
          <h2 className="section-title">选一条路，看它的真相</h2>
        </div>
        <ul className="space-y-2.5">
          {data.paths.map(path => (
            <PathRow key={path.id} data={{ id: path.id, title: path.title, status: path.status }} />
          ))}
        </ul>
      </section>

      {myths.length > 0 && (
        <section className="mt-14">
          <div className="section-head">
            <span className="section-num">02</span>
            <h2 className="section-title">大一新生常见误区</h2>
          </div>
          <BlockRenderer blocks={myths} grade={null} />
        </section>
      )}

      {rest.length > 0 && (
        <section className="mt-14">
          <div className="section-head">
            <span className="section-num">03</span>
            <h2 className="section-title">七条路径横向对比</h2>
          </div>
          <BlockRenderer blocks={rest} grade={null} />
        </section>
      )}
    </div>
  )
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @navi/web test PathsPage`
Expected: PASS（5 用例）。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/PathsPage.tsx apps/web/src/pages/PathsPage.test.tsx
git commit -m "feat(web): 路径总览页——七条路径入口与通用知识"
```

---

### Task 5: 接上路由与首页入口

**Files:**
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/App.test.tsx`
- Modify: `apps/web/src/pages/HomePage.tsx`
- Modify: `apps/web/src/pages/HomePage.test.tsx`

- [ ] **Step 1: 写失败测试**

在 `apps/web/src/App.test.tsx` 的 mock 清单里补上 `fetchOverview`（该文件已有的 `vi.mock('./api.js', …)` 返回对象里加一项），并把 import 行改为：

```tsx
import { fetchMe, fetchOverview, fetchPathKnowledge, fetchQuestions } from './api.js'
```

在 mock 返回对象里加：

```tsx
    fetchOverview: vi.fn(),
```

在 `describe('App 路由外壳', …)` 里追加：

```tsx
  it('/paths 渲染路径总览（免登录）', async () => {
    vi.mocked(fetchMe).mockResolvedValue(null)
    vi.mocked(fetchOverview).mockResolvedValue({ paths: [], common: [] })
    window.history.pushState({}, '', '/paths')
    render(<App />)
    expect(await screen.findByRole('heading', { name: '七条路径' })).toBeInTheDocument()
  })
```

在 `apps/web/src/pages/HomePage.test.tsx` 的 `describe('HomePage', …)` 里追加：

```tsx
  it('页尾引导指向路径总览，不登录也能看（spec §5.1）', async () => {
    vi.mocked(fetchMe).mockResolvedValue(null)
    renderHome()
    expect(await screen.findByRole('link', { name: '七条路径的真相与对比' }))
      .toHaveAttribute('href', '/paths')
  })
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @navi/web test App HomePage`
Expected: FAIL——`/paths` 落兜底重定向回 `/`（断言拿不到「七条路径」标题）；首页链接仍指向 `/path/same-discipline-baoyan`。

- [ ] **Step 3: 加路由**

在 `apps/web/src/App.tsx` 顶部 import 区加（按该文件既有的字母序，插在 `PathDetailPage` 与 `QuizPage` 之间）：

```tsx
import { PathsPage } from './pages/PathsPage.js'
```

在 `<Route path="/path/:pathId">…</Route>` 之后加：

```tsx
        <Route path="/paths" component={PathsPage} />
```

（`/paths` 是单段路径，与 `/path/:pathId` 不冲突，顺序无关。）

- [ ] **Step 4: 改首页入口**

把 `apps/web/src/pages/HomePage.tsx` 页尾那段改为：

```tsx
        <p className="mt-12 text-center text-[13px] text-ink-3">
          也可以先随便看看——<Link href="/paths" className="text-accent-deep">七条路径的真相与对比</Link>，不登录也能读。
        </p>
```

- [ ] **Step 5: 运行确认通过**

Run: `pnpm --filter @navi/web test`
Expected: PASS（全量，含新增 2 条）。

- [ ] **Step 6: 全仓验证**

Run: `pnpm test`
Expected: PASS；知识库编译输出「7 条路径、10 个指标、24 道题目，0 条警告」。

Run: `pnpm lint`
Expected: 通过（5 个包全部无输出）。

Run: `pnpm build`
Expected: 通过。

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/App.tsx apps/web/src/App.test.tsx apps/web/src/pages/HomePage.tsx apps/web/src/pages/HomePage.test.tsx
git commit -m "feat(web): 接上 /paths 路由，首页浏览引导改指路径总览"
```

---

## 收尾自查（对照 spec §10）

- [ ] 1. `pnpm build` / `pnpm lint` / `pnpm test` 全绿，知识库编译 0 告警（Task 5 Step 6）。
- [ ] 6.（本计划新覆盖）`/paths` 免登录可访问（Task 5 Step 1 的 `fetchMe` 返回 null 仍渲染）；浏览态路径行不出现匹配条、匹配分或空条（Task 3 Step 1 第 2 例、Task 4 Step 1 第 2 例）；七条路径与 `common.md` 全部通用块均呈现（Task 4 Step 1 第 1 例）。
- [ ] 7.（本计划新覆盖）抽出 `PathRow` 后结果页行为不变（Task 3 Step 6，既有 12 用例全绿）。

spec §10 其余各条（重复测评一致、无「邮箱」字样、三种降级路径、桌面端观感）由既有测试覆盖，本计划未触碰相关代码。

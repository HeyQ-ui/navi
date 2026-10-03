# Navi 用户绑定上下文与账号级对话 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 agent 上下文绑定到用户（纳入最近 4 次自我测评摘要），把追问改成整个账号一条连续对话流、且以服务端为真相源，并给解读加上「你的变化」段。

**Architecture:** 新增 `messages` 表承载账号级对话；`/api/chat` 的入参从「客户端上传整段历史」改为「只发本轮问题」，历史由服务端从自己的库读、按来源过滤后组装进上下文，回答在流正常结束后才落库。`packages/llm` 的上下文从「单条记录」扩为「当次记录 + 历次自我测评 + 对话轮次」，新增两段渲染与两处提示词约束。解读输出由三段改四段。

**Tech Stack:** TypeScript · pnpm workspace · Hono · `node:sqlite` · Vercel AI SDK v7（`ai@7.0.127` / `@ai-sdk/react@4.0.130`）· React + Vite · Vitest

**Spec:** `docs/superpowers/specs/2026-10-02-navi-account-storage-design.md`（§11 是本计划的主体，§7 是不变量）。主文档 `docs/superpowers/specs/2026-09-27-navi-career-planning-agent-design.md` 是上位真相源，本计划最后一任务同步它。

## Global Constraints

- **零新依赖。** 不得往任何 `package.json` 加依赖。
- `packages/core` 零框架依赖、零网络、零 I/O；`packages/llm` 只依赖 core 的类型，**不认识存储**——所有落库都在 `apps/api`。
- 前端不得出现任何 API Key；前端连 JWT 都读不到（httpOnly cookie）。
- `.env` 与 `apps/api/data/` 必须留在 `.gitignore`。
- 知识库内容不得硬编码进 TypeScript 源码。
- 推荐结果由 `core` 确定性算法得出，模型只做解读与追问。
- 提交信息用中文，遵循 Conventional Commits。
- 导入路径是 `hono/jwt` 与 `hono/cookie`（不是 `hono/middleware/jwt` / `hono/helper/cookie`）。
- `node:sqlite` 在 `apps/api` 里用 `createRequire` 取（见 `store.ts` 顶部注释，静态 import 过不了 vitest 的解析）。

## Review Focus

以下五类输入/失效模式是 spec 蕴含、但没有哪个任务的测试天然覆盖的。每条都在拥有相关代码的任务里配了测试（位置见括号），执行时逐条确认。

1. **半截回答绝不能落库。** 对话写入必须复用 `persistInterpretation` 的 `finishReason` 闸门。模型中途断开时 `.text` 会静默 resolve 出半截文本（`packages/llm/src/index.test.ts` 里有这条已知缺陷的用例）；半截回答一旦落库，就成了后续**所有**上下文的既定事实，比半截解读更毒。（Task 3）
2. **`source='other'` 的测评数据永不进上下文。** 绑到用户之后上下文是多记录的，来源过滤是唯一挡住「拿别人的画像解释你」的东西。测试要覆盖三个方向：`other` 的测评摘要不进；`other` 的对话轮次**在查看该记录时**进；**离开后不进**。（Task 1、Task 3）
3. **对话流是账号级的，不能被 `pathId` 切碎。** 换路径追问要接着上文；只有「当前查看的记录」影响来源过滤，路径不影响过滤。（Task 1、Task 3）
4. **客户端不再能伪造对话历史。** 入参只收本轮 `question`；请求体里夹带 `messages` 必须被忽略。（Task 3）
5. **首次测评（无历史）时「你的变化」段照实说明。** 上下文里只有一条自我测评时，模型可能编一份「上次」出来——提示词与测试都要钉住这一点。（Task 4）

---

### Task 1: store —— `messages` 表与按来源过滤的读取

**Files:**
- Modify: `apps/api/src/store.ts`
- Modify: `apps/api/src/store.test.ts`
- Modify: `docs/superpowers/specs/2026-10-02-navi-account-storage-design.md`（§11.2 / §11.4 回填，见 Step 6）

**Interfaces:**
- Consumes: Task 已有的 `Store`、`Source`、`openStore`
- Produces:
  - `interface ChatTurn { id: string; assessmentId: string | null; pathId: string | null; source: Source; role: 'user' | 'assistant'; content: string; createdAt: string }`
  - `Store.appendTurn(input: { userId: string; assessmentId: string | null; pathId: string | null; source: Source; userText: string; assistantText: string }): void`
  - `Store.recentTurns(userId: string, currentAssessmentId: string | null, limit: number): ChatTurn[]` —— **按时间正序返回**，便于直接拼进上下文

- [ ] **Step 1: 写失败测试**

在 `apps/api/src/store.test.ts` 末尾追加：

```ts
describe('messages（账号级对话流）', () => {
  function seed(store: Store) {
    const user = store.createUser('alice', 'pw123456')
    const self = store.createAssessment({ userId: user.id, ...input, source: 'self' })
    const other = store.createAssessment({ userId: user.id, ...input, source: 'other' })
    return { userId: user.id, self, other }
  }

  it('追加一轮后能按时间正序读回', () => {
    const { userId, self } = seed(store)
    store.appendTurn({
      userId, assessmentId: self, pathId: 'p1', source: 'self',
      userText: '保研和考研怎么选？', assistantText: '两者的时间窗不同。',
    })

    const turns = store.recentTurns(userId, self, 20)
    expect(turns.map(t => t.role)).toEqual(['user', 'assistant'])
    expect(turns[0]!.content).toBe('保研和考研怎么选？')
    expect(turns[1]!.content).toBe('两者的时间窗不同。')
    expect(turns[0]!.source).toBe('self')
  })

  it('对话流是全账号一条：换路径、换记录都读得到', () => {
    const { userId, self, other } = seed(store)
    store.appendTurn({
      userId, assessmentId: self, pathId: 'p1', source: 'self',
      userText: '第一问', assistantText: '第一答',
    })
    store.appendTurn({
      userId, assessmentId: self, pathId: 'p2', source: 'self',   // 换了路径
      userText: '第二问', assistantText: '第二答',
    })

    const atP2 = store.recentTurns(userId, self, 20)
    expect(atP2.map(t => t.content)).toEqual(['第一问', '第一答', '第二问', '第二答'])
    void other
  })

  it('来源过滤：other 的轮次只在查看那条记录时进来', () => {
    const { userId, self, other } = seed(store)
    store.appendTurn({
      userId, assessmentId: self, pathId: 'p1', source: 'self',
      userText: '关于我自己', assistantText: '答我自己',
    })
    store.appendTurn({
      userId, assessmentId: other, pathId: 'p1', source: 'other',
      userText: '关于我朋友', assistantText: '答我朋友',
    })

    // 查看自己的记录：别人的轮次不出现
    expect(store.recentTurns(userId, self, 20).map(t => t.content))
      .toEqual(['关于我自己', '答我自己'])

    // 查看那条 other 记录：它自己的轮次回来，self 的也在（账号级流）
    expect(store.recentTurns(userId, other, 20).map(t => t.content))
      .toEqual(['关于我自己', '答我自己', '关于我朋友', '答我朋友'])
  })

  it('只看得到本人的对话', () => {
    const { userId, self } = seed(store)
    const bob = store.createUser('bob', 'pw123456')
    store.appendTurn({
      userId, assessmentId: self, pathId: null, source: 'self',
      userText: '爱丽丝的问题', assistantText: '答',
    })
    expect(store.recentTurns(bob.id, null, 20)).toEqual([])
  })

  it('limit 取最近 N 轮，但仍按时间正序返回', () => {
    const { userId, self } = seed(store)
    for (let i = 1; i <= 5; i += 1) {
      store.appendTurn({
        userId, assessmentId: self, pathId: null, source: 'self',
        userText: `第${i}问`, assistantText: `第${i}答`,
      })
    }
    const turns = store.recentTurns(userId, self, 4)
    expect(turns.map(t => t.content)).toEqual(['第3问', '第3答', '第4问', '第4答'])
  })

  it('currentAssessmentId 为 null 时只纳入 self 的轮次', () => {
    const { userId, self, other } = seed(store)
    store.appendTurn({
      userId, assessmentId: self, pathId: null, source: 'self',
      userText: '自己', assistantText: '答自己',
    })
    store.appendTurn({
      userId, assessmentId: other, pathId: null, source: 'other',
      userText: '别人', assistantText: '答别人',
    })
    expect(store.recentTurns(userId, null, 20).map(t => t.content)).toEqual(['自己', '答自己'])
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @navi/api test -- store`
Expected: FAIL —— `store.appendTurn is not a function`。

- [ ] **Step 3: 实现**

在 `apps/api/src/store.ts` 里加类型、建表语句与两个方法。

建表加在现有 `assessments` 建表之后（**`source` 是 NOT NULL**：来源在写入时就知道且永不改变，把它冗余在消息行上，来源过滤就成了一条 WHERE，不必 JOIN 回 `assessments`）：

```sql
CREATE TABLE IF NOT EXISTS messages (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id),
  assessment_id TEXT,
  path_id       TEXT,
  source        TEXT NOT NULL CHECK (source IN ('self','other')),
  role          TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content       TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_user
  ON messages(user_id, created_at);
```

类型与接口：

```ts
export interface ChatTurn {
  id: string
  assessmentId: string | null
  pathId: string | null
  source: Source
  role: 'user' | 'assistant'
  content: string
  createdAt: string
}
```

`Store` 接口加两个方法：

```ts
  /** 一轮问答成对写入。只在回答的流正常结束后调用（见 apps/api/src/server.ts 的闸门） */
  appendTurn(input: {
    userId: string
    assessmentId: string | null
    pathId: string | null
    source: Source
    userText: string
    assistantText: string
  }): void

  /**
   * 该账号最近的对话轮次，**按时间正序**返回。
   *
   * 来源过滤：`source='self'` 的一律纳入；`source='other'` 的只有锚点是
   * `currentAssessmentId` 时才纳入——这样在「测测别人」的页面上能连续追问，
   * 回到自己的页面时别人的轮次不混进来（spec §7、§11.4）。
   */
  recentTurns(userId: string, currentAssessmentId: string | null, limit: number): ChatTurn[]
```

实现：

```ts
    appendTurn(input) {
      const now = new Date().toISOString()
      const insert = db.prepare(
        `INSERT INTO messages
           (id, user_id, assessment_id, path_id, source, role, content, created_at)
         VALUES (?,?,?,?,?,?,?,?)`,
      )
      // 两条一起写：失败的轮次什么都不落库，否则上下文里会留下
      // 「用户问了但没人答」的悬空轮次（spec §11.3）
      insert.run(randomUUID(), input.userId, input.assessmentId, input.pathId,
        input.source, 'user', input.userText, now)
      insert.run(randomUUID(), input.userId, input.assessmentId, input.pathId,
        input.source, 'assistant', input.assistantText, now)
    },

    recentTurns(userId, currentAssessmentId, limit) {
      // 先按时间倒序取最近 N 条，再翻正——LIMIT 必须作用在倒序上才对
      const rows = db.prepare(
        `SELECT * FROM messages
         WHERE user_id = ?
           AND (source = 'self' OR assessment_id = ?)
         ORDER BY created_at DESC, rowid DESC
         LIMIT ?`,
      ).all(userId, currentAssessmentId, limit) as unknown as MessageDbRow[]

      return rows.reverse().map(toChatTurn)
    },
```

配 `MessageDbRow` 与 `toChatTurn`（同 `toUser` 的理由：`.all()` 返回 null 原型对象，逐字段映射）：

```ts
interface MessageDbRow {
  id: string
  assessment_id: string | null
  path_id: string | null
  source: string
  role: string
  content: string
  created_at: string
}

function toChatTurn(row: MessageDbRow): ChatTurn {
  return {
    id: row.id,
    assessmentId: row.assessment_id,
    pathId: row.path_id,
    source: row.source as Source,
    role: row.role as ChatTurn['role'],
    content: row.content,
    createdAt: row.created_at,
  }
}
```

> `assessment_id = ?` 传 `null` 时在 SQL 里恒为 NULL（不为真），所以「只看 self 轮次」天然成立——上面的 `currentAssessmentId 为 null` 用例钉的就是这个语义。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @navi/api test`
Expected: PASS，新增 6 个用例全绿，原有 68 个不受影响。

- [ ] **Step 5: 跑类型检查与 lint**

Run: `pnpm --filter @navi/api build && pnpm --filter @navi/api lint`
Expected: 均无输出（成功）。

- [ ] **Step 6: 回填 spec 的一处死条款**

spec §11.4 末尾那句「对话轮次里 `assessment_id` 为 `NULL` 的（旧数据）按 `self` 处理，宁可多纳入也不要凭空丢掉上下文」**在新设计下不成立**：这是新建的表，没有旧数据；而 `source` 是 `NOT NULL` 且写入时就定，过滤不依赖 `assessment_id` 是否为 NULL。把这句删掉，并在 §11.2 的建表 SQL 里补上 `source` 列与 `NOT NULL` 约束，保持 spec 与实现一致。

- [ ] **Step 7: 提交**

```bash
git add apps/api/src/store.ts apps/api/src/store.test.ts docs/superpowers/specs/2026-10-02-navi-account-storage-design.md
git commit -m "feat(api): store 新增 messages 表与按来源过滤的对话读取"
```

---

### Task 2: `packages/llm` —— 上下文扩展（历次自我测评 + 对话轮次）

**Files:**
- Modify: `packages/llm/src/context.ts`
- Modify: `packages/llm/src/context.test.ts`
- Modify: `packages/llm/src/index.ts`

**Interfaces:**
- Consumes: 无（纯类型与字符串拼接）
- Produces:
  - `interface HistoryAssessment { createdAt: string; result: DiagnosisResult }`
  - `interface ChatTurnForContext { role: 'user' | 'assistant'; content: string }`
  - `KnowledgeSlice` 新增两个**可选**字段：`history?: HistoryAssessment[]`（时间倒序）、`conversation?: ChatTurnForContext[]`（时间正序）
  - `streamInterpret` / `streamChat` 的入参同样透传这两个字段

字段做成可选，是为了让 Task 3 能分两步改：先加渲染与透传（本任务，行为不变），再接上数据源。

- [ ] **Step 1: 写失败测试**

在 `packages/llm/src/context.test.ts` 末尾追加：

```ts
const priorResult: DiagnosisResult = {
  indicators: {
    'academic-interest': { score: 40, known: true, consistency: 0.8, sources: ['q1'] },
  },
  paths: [{
    id: 'same-discipline-kaoyan', match: 44, confidence: 0.6,
    eligibility: { applicable: true, hardFailures: [], softWarnings: [] },
    contributions: [],
  }],
  archetypes: [],
}

describe('上下文 · 历次自我测评（spec §11.4）', () => {
  it('有历史时渲染出时间、分数与主推荐路径', () => {
    const text = buildSystemContent({
      ...baseSlice,
      history: [{ createdAt: '2026-01-05T00:00:00.000Z', result: priorResult }],
    })
    expect(text).toContain('2026-01-05')
    expect(text).toContain('学术志趣：40/100')
    // 断言路径 **id** 而不是中文名：id 一定会出现（查不到标题时回落到 id），
    // 而 context.test.ts 的 bundle 里未必有这条路径
    expect(text).toContain('same-discipline-kaoyan')
  })

  it('有历史时刻意说明「不含本次」，免得模型把当次当成历史', () => {
    const text = buildSystemContent({
      ...baseSlice,
      history: [{ createdAt: '2026-01-05T00:00:00.000Z', result: priorResult }],
    })
    expect(text).toContain('不含本次')
  })

  it('没有历史时整段不出现，而不是留一个空标题', () => {
    expect(buildSystemContent({ ...baseSlice })).not.toContain('历次自我测评')
    expect(buildSystemContent({ ...baseSlice, history: [] })).not.toContain('历次自我测评')
  })
})

describe('上下文 · 此前的对话（spec §11.4）', () => {
  it('按角色渲染成对话记录', () => {
    const text = buildSystemContent({
      ...baseSlice,
      conversation: [
        { role: 'user', content: '保研和考研怎么选？' },
        { role: 'assistant', content: '两者的时间窗不同。' },
      ],
    })
    expect(text).toContain('保研和考研怎么选？')
    expect(text).toContain('两者的时间窗不同。')
  })

  it('没有对话时整段不出现', () => {
    expect(buildSystemContent({ ...baseSlice })).not.toContain('此前的对话')
    expect(buildSystemContent({ ...baseSlice, conversation: [] })).not.toContain('此前的对话')
  })
})
```

`baseSlice` 是本文件里已有的那套 fixture；若现有的写法是内联字面量，就抽一个 `baseSlice` 常量供新旧用例共用（改动仅限测试文件）。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @navi/llm test -- context`
Expected: FAIL —— 两个新 describe 找不到 `历次自我测评` / `此前的对话`。

- [ ] **Step 3: 实现 `context.ts`**

`KnowledgeSlice` 加两个可选字段（把现有定义贴上即可，别改动已有字段）：

```ts
export interface HistoryAssessment {
  createdAt: string
  result: DiagnosisResult
}

export interface ChatTurnForContext {
  role: 'user' | 'assistant'
  content: string
}

export interface KnowledgeSlice {
  bundle: KnowledgeBundle
  result: DiagnosisResult
  /** 「本路径」——学生当前查看的那一条 */
  pathId: string
  /** 本次逐题作答（题目 id → 选项序号 0–4） */
  answers: Answers
  /** 历次自我测评摘要（不含当次），时间**倒序**。空或不传时整段不渲染 */
  history?: HistoryAssessment[]
  /** 已按来源过滤的对话轮次，时间**正序**。空或不传时整段不渲染 */
  conversation?: ChatTurnForContext[]
}
```

两个渲染函数：

```ts
/**
 * 历次自我测评摘要（spec §11.4）。
 *
 * 不含当次——当次的完整结果已在上面的「诊断结果」段里，列进来就是重复。
 * 标题里明说「不含本次」，是因为模型看到一串历史时很容易把最近那条当成当次，
 * 那会让「你的变化」段算错一次。
 */
function formatHistory(slice: KnowledgeSlice): string | null {
  const history = slice.history ?? []
  if (history.length === 0) return null

  const titles = new Map(slice.bundle.paths.map(p => [p.id, p.title]))
  const names = new Map(slice.bundle.indicators.map(i => [i.id, i.name]))

  return history.map(entry => {
    const main = findTiedPaths(entry.result)[0]
    const date = entry.createdAt.slice(0, 10)
    const scores = Object.entries(entry.result.indicators)
      .map(([id, s]) => `${names.get(id) ?? id}：${s.known ? `${Math.round(s.score)}/100` : '无数据'}`)
      .join('，')
    const path = main === undefined
      ? '当前没有匹配的路径'
      : `主推荐路径：${titles.get(main.id) ?? main.id}（匹配度 ${Math.round(main.match)}）`
    return `- ${date} ${path}\n  ${scores}`
  }).join('\n')
}

/** 此前的对话（spec §11.4）。只渲染内容，不渲染时间——时间对判断没有帮助 */
function formatConversation(slice: KnowledgeSlice): string | null {
  const conversation = slice.conversation ?? []
  if (conversation.length === 0) return null
  return conversation
    .map(turn => `${turn.role === 'user' ? '学生' : '你'}：${turn.content}`)
    .join('\n\n')
}
```

`import { findTiedPaths } from '@navi/core'` —— `context.ts` 目前只导入类型，这次要引入一个值导入（`diagnose` 不在这里用，只加 `findTiedPaths`）。

`buildSystemContent` 的返回数组里插两段（其余段落原样不动）：

- 「历次自我测评」插在 `### 本路径（X）的匹配依据` 段之后
- 「此前的对话」插在 `## 全部路径摘要` 之后、`## 我们无法可靠回答的问题` 之前（离对话最近，符合信息的新近性）

条件插入，别留空标题：

```ts
  const historyBlock = formatHistory(slice)
  const conversationBlock = formatConversation(slice)

  return [
    '<knowledge>',
    // …（现有段落顺序不变）
    ...(historyBlock === null
      ? []
      : ['', '## 历次自我测评（最近数次，不含本次）', historyBlock]),
    // …
    ...(conversationBlock === null
      ? []
      : ['', '## 此前的对话（最近数轮）', conversationBlock]),
    // …
  ].join('\n')
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @navi/llm test`
Expected: PASS，新增 5 个用例全绿。

- [ ] **Step 5: 透传到 `index.ts`**

`streamInterpret` 与 `streamChat` 的入参类型各加 `history?: HistoryAssessment[]` 与
`conversation?: ChatTurnForContext[]`，并在 `sliceOf` 里透传：

```ts
function sliceOf(
  answers: Answers,
  bundle: KnowledgeBundle,
  pathId: string,
  result?: DiagnosisResult,
  history?: HistoryAssessment[],
  conversation?: ChatTurnForContext[],
): KnowledgeSlice {
  return { bundle, result: result ?? diagnose(answers, bundle), pathId, answers, history, conversation }
}
```

> 参数已经到六个了。**这一步只做透传，不做重构**——把它换成 options 对象是另一件事，
> 现在顺手改会让 Task 3 的 diff 混进无关改动。若执行时觉得参数表已经碍眼，
> 记进 ledger 作为 deferred minor，别在这里动。

**同时要做的导出**：`HistoryAssessment` 与 `ChatTurnForContext` 两个类型必须从
`packages/llm/src/index.ts` 转出去（Task 3 的 `apps/api` 要 import 它们）：

```ts
export type { HistoryAssessment, ChatTurnForContext } from './context.js'
```

漏了这一步，Task 3 会在 `error TS2305: Module '"@navi/llm"' has no exported member` 上卡住。

- [ ] **Step 6: 跑全量测试与构建**

Run: `pnpm --filter @navi/llm test && pnpm --filter @navi/llm build`
Expected: 均通过。

- [ ] **Step 7: 提交**

```bash
git add packages/llm/src/context.ts packages/llm/src/context.test.ts packages/llm/src/index.ts
git commit -m "feat(llm): 上下文支持历次自我测评与对话轮次两段"
```

---

### Task 3: `/api/chat` 改造 —— 服务端为真相源

**Files:**
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/src/server.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `appendTurn` / `recentTurns` / `ChatTurn`；Task 2 的 `history` / `conversation` 入参
- Produces:
  - `POST /api/chat` 入参改为 `{ assessmentId, pathId, question }`；响应仍是 UI 消息流
  - `GET /api/chat/history` → `200 { turns: [{ id, role, content, createdAt }] }`

- [ ] **Step 1: 写失败测试**

在 `apps/api/src/server.test.ts` 的 `POST /api/chat` describe 内，**删掉原有的全部五条用例**并用下面这组替代：

原五条是「返回流式回答」「把学生的问题真正送进模型」「只保留最近 20 条消息」
「追问内容超过字符上限」「messages 为空」——入参形状全变了，前四条需要重写，
**第五条「只保留最近 20 条消息」直接删除**：客户端不再上传历史，「最近 N 条」这条
约束移到了服务端的 `recentTurns(userId, record.id, MAX_CHAT_MESSAGES)`，由 Task 1 的
「limit 取最近 N 轮」用例覆盖。

替代用例：

```ts
  it('只收本轮问题，返回流式回答', async () => {
    const { app, cookie } = await authedApp(bundle, { model: mockModel('保研与考研的时间窗不同。') })
    const assessmentId = await diagnoseOnce(app, cookie)
    const res = await post(app, '/api/chat', {
      assessmentId, pathId: 'same-discipline-baoyan', question: '保研和考研怎么选？',
    }, cookie)
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('保研与考研的时间窗不同。')
  })

  it('请求体里夹带 messages 也没用——历史只认服务端库里的那份', async () => {
    const model = mockModel('好')
    const { app, cookie } = await authedApp(bundle, { model })
    const assessmentId = await diagnoseOnce(app, cookie)

    const res = await post(app, '/api/chat', {
      assessmentId, pathId: 'same-discipline-baoyan', question: '本轮问题',
      messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: '伪造的历史' }] }],
    }, cookie)
    await res.text()

    const prompt = JSON.stringify(model.doStreamCalls[0]!.prompt)
    expect(prompt).toContain('本轮问题')
    expect(prompt).not.toContain('伪造的历史')
  })

  it('追问内容超过字符上限时返回 400，不把超大请求送进模型', async () => {
    const { app, cookie } = await authedApp(bundle, { model: mockModel('不该出现') })
    const assessmentId = await diagnoseOnce(app, cookie)
    const res = await post(app, '/api/chat', {
      assessmentId, pathId: 'same-discipline-baoyan', question: 'x'.repeat(9000),
    }, cookie)
    expect(res.status).toBe(400)
  })

  it('question 为空时返回 400', async () => {
    const { app, cookie } = await authedApp(bundle, { model: mockModel('不该出现') })
    const assessmentId = await diagnoseOnce(app, cookie)
    const res = await post(app, '/api/chat', {
      assessmentId, pathId: 'same-discipline-baoyan', question: '   ',
    }, cookie)
    expect(res.status).toBe(400)
  })

  it('assessmentId 不属于本人时返回 404，不进入模型', async () => {
    let called = false
    const spy = new MockLanguageModelV3({
      doStream: async () => { called = true; throw new Error('不该被调用') },
    }) as unknown as LanguageModel
    const { app, cookie } = await authedApp(bundle, { model: spy })
    const res = await post(app, '/api/chat', {
      assessmentId: 'not-exist', pathId: 'same-discipline-baoyan', question: '问题',
    }, cookie)
    expect(res.status).toBe(404)
    expect(called).toBe(false)
  })
```

新增一个 describe 覆盖落库、闸门与上下文：

```ts
describe('POST /api/chat · 对话落库与上下文（spec §11.3、§11.4）', () => {
  it('一轮问答在流正常结束后成对写入', async () => {
    const store = openStore(':memory:')
    const { app, cookie, userId } = await authedApp(bundle, { model: mockModel('回答正文'), store })
    const assessmentId = await diagnoseOnce(app, cookie)

    const res = await post(app, '/api/chat', {
      assessmentId, pathId: 'same-discipline-baoyan', question: '问题正文',
    }, cookie)
    await res.text()

    await vi.waitFor(() => {
      const turns = store.recentTurns(userId, assessmentId, 20)
      expect(turns.map(t => t.content)).toEqual(['问题正文', '回答正文'])
    })
  })

  it('流中途出错时一轮都不写（半截回答不能成为后续上下文的既定事实）', async () => {
    const brokenMidStream = new MockLanguageModelV3({
      doStream: async () => ({
        stream: simulateReadableStream({
          chunks: [
            { type: 'text-start', id: '1' },
            { type: 'text-delta', id: '1', delta: '前半句' },
            { type: 'error', error: new Error('模型中途断开') },
          ],
        }),
      }) as never,
    })

    const store = openStore(':memory:')
    const { app, cookie, userId } = await authedApp(bundle, { model: brokenMidStream, store })
    const assessmentId = await diagnoseOnce(app, cookie)

    const res = await post(app, '/api/chat', {
      assessmentId, pathId: 'same-discipline-baoyan', question: '会失败的问题',
    }, cookie)
    await res.text().catch(() => undefined)

    await new Promise(resolve => setTimeout(resolve, 100))
    expect(store.recentTurns(userId, assessmentId, 20)).toEqual([])
  })

  it('第二轮追问带上第一轮的回答（账号级流是连续的）', async () => {
    const model = mockModel('第一轮的回答')
    const store = openStore(':memory:')
    const { app, cookie } = await authedApp(bundle, { model, store })
    const assessmentId = await diagnoseOnce(app, cookie)

    const first = await post(app, '/api/chat', {
      assessmentId, pathId: 'same-discipline-baoyan', question: '第一轮的问题',
    }, cookie)
    await first.text()
    await vi.waitFor(() => expect(model.doStreamCalls.length).toBe(1))

    const second = await post(app, '/api/chat', {
      assessmentId, pathId: 'same-discipline-baoyan', question: '第二轮的问题',
    }, cookie)
    await second.text()

    const prompt = JSON.stringify(model.doStreamCalls[1]!.prompt)
    expect(prompt).toContain('第一轮的问题')
    expect(prompt).toContain('第一轮的回答')
    expect(prompt).toContain('第二轮的问题')
  })

  it('换路径追问时上文仍在（路径不影响过滤）', async () => {
    const model = mockModel('回答')
    const store = openStore(':memory:')
    const { app, cookie } = await authedApp(bundle, { model, store })
    const assessmentId = await diagnoseOnce(app, cookie)

    const first = await post(app, '/api/chat', {
      assessmentId, pathId: 'same-discipline-baoyan', question: '在保研页问的',
    }, cookie)
    await first.text()
    await vi.waitFor(() => expect(model.doStreamCalls.length).toBe(1))

    const second = await post(app, '/api/chat', {
      assessmentId, pathId: 'different-path', question: '换页后问的',
    }, cookie)
    expect(second.status).toBe(200)
    await second.text()

    expect(JSON.stringify(model.doStreamCalls[1]!.prompt)).toContain('在保研页问的')
  })
})

describe('GET /api/chat/history', () => {
  it('返回本人的对话轮次，按时间正序', async () => {
    const store = openStore(':memory:')
    const { app, cookie, userId } = await authedApp(bundle, { model: mockModel('回答'), store })
    const assessmentId = await diagnoseOnce(app, cookie)
    await (await post(app, '/api/chat', {
      assessmentId, pathId: 'same-discipline-baoyan', question: '问题',
    }, cookie)).text()

    await vi.waitFor(() => expect(store.recentTurns(userId, assessmentId, 20)).toHaveLength(2))

    const res = await app.request('/api/chat/history', { headers: { cookie } })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { turns: Array<{ role: string; content: string }> }
    expect(body.turns.map(t => t.role)).toEqual(['user', 'assistant'])
    expect(body.turns[0]!.content).toBe('问题')
  })

  it('不带会话 cookie 返回 401', async () => {
    const { app } = await authedApp()
    expect((await app.request('/api/chat/history')).status).toBe(401)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @navi/api test -- server`
Expected: FAIL —— 新的 chat 用例大面积红（`question` 被当成未知字段、`/api/chat/history` 404）。

- [ ] **Step 3: 实现**

`/api/chat` 改为：

```ts
  app.post('/api/chat', requireSession(auth), async c => {
    const body = await readBody(c)
    if (body instanceof Response) return body

    const record = loadRecord(c, getStore(), body)
    if (record instanceof Response) return record

    const pathId = pathIdInRecord(body, record)
    if (pathId === null) {
      const asked = String((body as { pathId?: unknown }).pathId ?? '')
      return c.json({ error: `路径不存在：${asked}` }, 404)
    }

    // 只收本轮问题。历史一律从自己的库读——请求体里的 messages 一概不看，
    // 与 assessmentId 同理：记录是服务端写的，客户端改不了，而请求体谁都能改。
    const rawQuestion = (body as { question?: unknown }).question
    const question = typeof rawQuestion === 'string' ? rawQuestion.trim() : ''
    if (question === '') return c.json({ error: 'question 为空' }, 400)
    if (question.length > MAX_CHAT_CHARS) {
      return c.json({ error: `追问内容过长：${question.length} 字符，上限 ${MAX_CHAT_CHARS}` }, 400)
    }

    if (!options.model && !process.env.DEEPSEEK_API_KEY) {
      return c.json({ error: '追问暂不可用：服务端未配置模型' }, 503)
    }

    const userId = sessionUser(c).id
    const conversation = getStore().recentTurns(userId, record.id, MAX_CHAT_MESSAGES)
      .map(turn => ({ role: turn.role, content: turn.content }))

    const scoped: KnowledgeBundle = {
      ...bundle, questions: scopeQuestions(bundle.questions, parseGrade(record.grade)),
    }
    const history = selfHistory(getStore(), userId, record.id)

    try {
      const stream = streamChat({
        answers: record.answers,
        pathId,
        bundle: scoped,
        result: record.result,
        history,
        conversation,
        messages: [{ role: 'user', content: question }],
      }, options)
      const response = stream.toUIMessageStreamResponse()
      persistTurn(stream, getStore(), {
        userId, assessmentId: record.id, pathId, source: record.source,
        userText: question,
      })
      return response
    } catch (error) {
      return c.json({ error: `追问暂不可用：${(error as Error).message}` }, 503)
    }
  })
```

两个新辅助（放在模块级，与 `persistInterpretation` 并列）：

```ts
/** 该用户最近的自次我测评摘要（不含当次），时间倒序。来源过滤见 spec §7 */
function selfHistory(store: Store, userId: string, currentId: string): HistoryAssessment[] {
  return store.listAssessments(userId)
    .filter(row => row.source === 'self' && row.id !== currentId)
    .slice(0, 4)
    .map(row => ({ createdAt: row.createdAt, result: row.result }))
}

/**
 * 一轮问答落库。与 persistInterpretation 同一个闸门、同一个理由：
 * `.text` 在流中途出错时会静默 resolve 出**已累积的半截文本**
 * （packages/llm/src/index.test.ts 里钉着这个缺陷）。半截回答一旦落库，
 * 就成了后续**所有**上下文的既定事实，比半截解读更毒。
 */
function persistTurn(
  stream: StreamResult,
  store: Store,
  ctx: { userId: string; assessmentId: string; pathId: string; source: Source; userText: string },
): void {
  void (async () => {
    try {
      if (await stream.finishReason !== 'stop') return
      const text = await stream.text
      if (text.trim() === '') return
      store.appendTurn({ ...ctx, assistantText: text })
    } catch {
      console.warn(`[api] 对话写入失败：${ctx.assessmentId}`)
    }
  })()
}
```

新增历史端点：

```ts
  app.get('/api/chat/history', requireSession(auth), c => {
    const turns = getStore().recentTurns(sessionUser(c).id, null, MAX_CHAT_MESSAGES)
    return c.json({
      turns: turns.map(t => ({
        id: t.id, role: t.role, content: t.content, createdAt: t.createdAt,
      })),
    })
  })
```

`toModelMessages` 与 `MAX_CHAT_MESSAGES`：前者不再被 chat 用到（历史来自库、问题来自 `question`），**删掉**；后者的语义从「最近 N 轮消息」变成「最近 N 条消息（含问答两侧）」，保留常量与名字，但把注释改准确。

`MAX_CHAT_CHARS` 的语义变为「单轮问题的字符上限」，注释同步改。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @navi/api test`
Expected: PASS，全部用例绿。

- [ ] **Step 5: 跑类型检查与 lint**

Run: `pnpm --filter @navi/api build && pnpm --filter @navi/api lint`
Expected: 均无输出。

- [ ] **Step 6: 提交**

```bash
git add apps/api/src/server.ts apps/api/src/server.test.ts
git commit -m "feat(api): /api/chat 改为服务端持有历史，新增 /api/chat/history"
```

---

### Task 4: 解读改四段 + 提示词两处约束

**Files:**
- Modify: `packages/llm/prompts/interpret.md`
- Modify: `packages/llm/prompts/chat.md`
- Modify: `packages/llm/src/prompts.test.ts`
- Modify: `apps/api/src/server.ts`（`/api/interpret` 也带上 `history` 与 `conversation`）

**Interfaces:**
- Consumes: Task 2 的 `history` / `conversation` 入参；Task 3 的 `selfHistory` 辅助
- Produces: 无新接口；`/api/interpret` 的上下文与 chat 对齐

- [ ] **Step 1: 改测试（钉住四段与两处约束）**

`packages/llm/src/prompts.test.ts` 里，把「三段式」那条改为四段：

```ts
describe('提示词 · 解读的输出结构（设计文档 §8.2、专项 §11.5）', () => {
  it('四段式，第三段对应「你的变化」', () => {
    const text = prompt('interpret')
    expect(text).toContain('你现在的位置')
    expect(text).toContain('为什么推荐这条路径')
    expect(text).toContain('你的变化')
    expect(text).toContain('接下来关注什么')
  })

  it('说明首次测评时「你的变化」段怎么写（不许编一份上次出来）', () => {
    expect(prompt('interpret')).toContain('第一次测评')
  })

  it('要求除「你的变化」段外不要主动做跨次对比', () => {
    expect(prompt('interpret')).toContain('不要主动做跨次对比')
  })

  it('追问：用户没明确提出对比时不要主动对比', () => {
    expect(prompt('chat')).toContain('不要主动对比')
  })
})
```

顺带检查现有的「三段式且第二段对应…」那条旧断言，**替换掉**而不是并存。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @navi/llm test -- prompts`
Expected: FAIL —— 找不到 `你的变化` 等。

- [ ] **Step 3: 改 `interpret.md`**

「输出要求」一节改为：

```md
## 输出要求

- 分四段，依次为：**你现在的位置**、**为什么推荐这条路径**、**你的变化**、**接下来关注什么**。
- 每段 2–4 句，总共不超过 600 字。
- 用第二人称「你」，语气平实，不煽情、不打鸡血。
- 直接输出正文，不要写标题以外的任何前后缀。

**「你的变化」段怎么写**：<knowledge> 里有你历次自我测评的摘要（标题里写明「不含本次」，
别把它当成当次）。把这次与之前对比，讲清画像往哪个方向动、这对路径判断意味着什么。

若这是这位学生的**第一次测评**（没有历次记录），这一段要**照实说明这是第一次测评、
还看不出变化**，并说一句这对后续意味着什么。**不要编造一份「上次」出来**——编造对比
比留白更糟。

除「你的变化」段以外，**不要主动做跨次对比**：其余三段按最近一次的情况讲。
学生明确要求对比时才另说。
```

- [ ] **Step 4: 改 `chat.md`**

把「就这条路径追问」的锚点口径改为账号级对话，并加约束：

```md
## 对话是连续的

<knowledge> 里有你们此前的对话（标题写明「最近数轮」）。接着聊，不要重复自我介绍，
也不要把已经说过的结论再说一遍。

**上下文里有多次自我测评数据，但学生没有明确提出对比时，不要主动对比**，
按最近一次的情况回答。学生问了历史或变化，再比。

学生当前正在看的是哪条路径，<knowledge> 里写了；他说的「这条路径」通常指的是它。
```

- [ ] **Step 5: 跑测试确认通过**

Run: `pnpm --filter @navi/llm test`
Expected: PASS。

- [ ] **Step 6: `/api/interpret` 对齐上下文**

`/api/interpret` 的 `streamInterpret` 入参加上 `history` 与 `conversation`，
取值方式与 Task 3 的 chat 完全一致（同两个辅助）：

```ts
    const userId = sessionUser(c).id
    const conversation = getStore().recentTurns(userId, record.id, MAX_CHAT_MESSAGES)
      .map(turn => ({ role: turn.role, content: turn.content }))
    const history = selfHistory(getStore(), userId, record.id)
```

并在 `apps/api/src/server.test.ts` 的 `POST /api/interpret` describe 内加一条：

```ts
  it('解读的上下文里带上历次自我测评（「你的变化」段要有东西可讲）', async () => {
    const model = mockModel('解读正文')
    const store = openStore(':memory:')
    const { app, cookie } = await authedApp(bundle, { model, store })

    // 先做一次，让第二次有历史可比
    await diagnoseOnce(app, cookie)
    const second = await diagnoseOnce(app, cookie)

    const res = await post(app, '/api/interpret',
      { assessmentId: second, pathId: 'same-discipline-baoyan' }, cookie)
    await res.text()

    const prompt = JSON.stringify(model.doStreamCalls[0]!.prompt)
    expect(prompt).toContain('历次自我测评')
    expect(prompt).toContain('不含本次')
  })
```

- [ ] **Step 7: 跑全量测试**

Run: `pnpm test`
Expected: 全部包全绿。

- [ ] **Step 8: 提交**

```bash
git add packages/llm/prompts packages/llm/src/prompts.test.ts apps/api/src/server.ts apps/api/src/server.test.ts
git commit -m "feat(llm,api): 解读改四段并加「你的变化」，提示词写入两处对比约束"
```

---

### Task 5: 前端 —— 对话区改为账号级

**Files:**
- Modify: `apps/web/src/api.ts`
- Modify: `apps/web/src/components/PathAssistant.tsx`
- Modify: `apps/web/src/components/PathAssistant.test.tsx`
- Modify: `apps/web/src/components/PathAssistant.stream.test.tsx`
- Modify: `apps/web/src/api.test.ts`

**Interfaces:**
- Consumes: Task 3 的 `POST /api/chat`（`{assessmentId, pathId, question}`）与 `GET /api/chat/history`
- Produces: `api.ts` 的 `fetchChatHistory(): Promise<ChatMessage[]>`

- [ ] **Step 1: 写失败测试**

`apps/web/src/api.test.ts` 追加：

```ts
describe('fetchChatHistory', () => {
  it('把服务端的轮次转成 UI 消息', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      turns: [
        { id: 'm1', role: 'user', content: '保研和考研怎么选？', createdAt: '2026-01-01T00:00:00.000Z' },
        { id: 'm2', role: 'assistant', content: '时间窗不同。', createdAt: '2026-01-01T00:00:01.000Z' },
      ],
    }), { status: 200 }))

    const messages = await fetchChatHistory()
    expect(messages).toHaveLength(2)
    expect(messages[0]!.role).toBe('user')
    expect(messages[0]!.parts).toEqual([{ type: 'text', text: '保研和考研怎么选？' }])
  })
})

describe('buildChatBody', () => {
  it('只取最后一条用户消息作为本轮问题，不把整段历史发上去', () => {
    // 直接断言 buildChatBody 的产出：比去 mock 整个 transport 简单得多，
    // 而它正是 prepareSendMessagesRequest 唯一会用到的东西
    const body = buildChatBody({
      assessmentId: 'a1',
      pathId: 'p1',
      messages: [
        { id: 'm1', role: 'user', parts: [{ type: 'text', text: '第一轮' }] },
        { id: 'm2', role: 'assistant', parts: [{ type: 'text', text: '第一答' }] },
        { id: 'm3', role: 'user', parts: [{ type: 'text', text: '第二轮' }] },
      ],
    })

    expect(body).toEqual({ assessmentId: 'a1', pathId: 'p1', question: '第二轮' })
  })

  it('把多段 part 拼成一段文本', () => {
    const body = buildChatBody({
      assessmentId: 'a1', pathId: 'p1',
      messages: [{ id: 'm1', role: 'user', parts: [
        { type: 'text', text: '前半' }, { type: 'text', text: '后半' },
      ] }],
    })
    expect(body.question).toBe('前后半')
  })
})
```

`PathAssistant.test.tsx` 追加（**这条放在组件测试里**，因为断言的是渲染结果）：

```tsx
it('挂载时从服务端拉历史并渲染（对话是账号级的，跨路径也在）', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
    turns: [
      { id: 'm1', role: 'user', content: '上一次聊过的问题', createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 'm2', role: 'assistant', content: '上一次的回答', createdAt: '2026-01-01T00:00:01.000Z' },
    ],
  }), { status: 200 }))

  render(<PathAssistant assessmentId="a1" pathId="p1" />)

  expect(await screen.findByText(/上一次聊过的问题/)).toBeInTheDocument()
  expect(screen.getByText(/上一次的回答/)).toBeInTheDocument()
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @navi/web test`
Expected: FAIL —— `fetchChatHistory` 未导出、`buildChatBody` 不存在。

- [ ] **Step 3: 实现**

`api.ts` 追加：

```ts
export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  parts: Array<{ type: 'text'; text: string }>
}

/** 账号级对话历史。服务端按来源过滤，前端只是显示者 */
export async function fetchChatHistory(): Promise<ChatMessage[]> {
  const res = await fetch('/api/chat/history')
  const body = (await jsonOrThrow(res, '获取对话历史')) as {
    turns: Array<{ id: string; role: 'user' | 'assistant'; content: string }>
  }
  return body.turns.map(turn => ({
    id: turn.id,
    role: turn.role,
    parts: [{ type: 'text' as const, text: turn.content }],
  }))
}

/**
 * 只发本轮问题。历史由服务端持有，客户端上传的那份它一概不看——
 * 把整段历史传上去既多传了数据，又给了伪造的机会。
 */
export function buildChatBody(input: {
  assessmentId: string
  pathId: string
  messages: ChatMessage[]
}): { assessmentId: string; pathId: string; question: string } {
  const last = input.messages[input.messages.length - 1]
  const question = (last?.parts ?? [])
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map(p => p.text)
    .join('')
    .trim()
  return { assessmentId: input.assessmentId, pathId: input.pathId, question }
}
```

`PathAssistant.tsx`：

- `transport` 改为带 `prepareSendMessagesRequest`：

```tsx
  const transport = useMemo(
    () => new DefaultChatTransport({
      api: '/api/chat',
      prepareSendMessagesRequest: ({ messages }) => ({
        body: buildChatBody({ assessmentId, pathId, messages: messages as ChatMessage[] }),
      }),
    }),
    [assessmentId, pathId],
  )
```

- `useChat` 拿到 `setMessages`，挂载时拉历史：

```tsx
  const { messages, setMessages, sendMessage, status, error: chatError } = useChat({ transport })

  useEffect(() => {
    // 账号级对话：换路径、换测评、下次登录都读同一条流，所以每次挂载都要重新拉
    let cancelled = false
    void fetchChatHistory().then(history => {
      if (!cancelled) setMessages(history)
    }).catch(() => { /* 拉历史失败不阻断追问 */ })
    return () => { cancelled = true }
  }, [assessmentId, setMessages])
```

- 对话区的标题与小字改为账号级口径（例如「追问」下加一行说明「你们此前的对话都在这里，换路径也会接着上文」）。

- `PathAssistant.stream.test.tsx` 的 `stubGlobal('fetch', ...)` 现在要能同时应付
  `/api/chat/history` 与 `/api/interpret` 两条请求——按 URL 分支返回。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @navi/web test`
Expected: PASS。

- [ ] **Step 5: 跑构建与 lint**

Run: `pnpm --filter @navi/web build && pnpm --filter @navi/web lint`
Expected: 均无输出。

- [ ] **Step 6: 提交**

```bash
git add apps/web/src
git commit -m "feat(web): 追问区改为账号级对话，只发本轮问题"
```

---

### Task 6: 主文档同步（v1.3）

**Files:**
- Modify: `docs/superpowers/specs/2026-09-27-navi-career-planning-agent-design.md`

**Interfaces:**
- Consumes: 前五个任务定下的形状
- Produces: 与实现一致的设计文档

- [ ] **Step 1: 改 §8.2「解读场景的输入构造」与输出结构**

- 输入构造：上下文不再只有当次测评，还含**最近 4 次自我测评摘要**与**账号级对话轮次**
- 输出结构：三段 → 四段，插入「你的变化」（列在第二段之后、第三段之前）

- [ ] **Step 2: 改 §4.2 第 4 条**

当前措辞是「上下文只由单一记录构造」这一类说法。绑到用户之后不成立，改为专项
§7 的两条规则（归属 + 来源），并指向专项文件。

- [ ] **Step 3: 改 §9.1 / §9.2**

对话区的口径：不是「就这条路径追问」，而是接着整条账号对话流聊；界面位置不变。

- [ ] **Step 4: 版本升到 v1.3 并附修订摘要**

- [ ] **Step 5: 全量验证并提交**

Run: `pnpm test && pnpm lint && pnpm build`
Expected: 三项全绿。

```bash
git add docs/superpowers/specs/2026-09-27-navi-career-planning-agent-design.md
git commit -m "docs: 主文档同步用户绑定上下文与四段解读（v1.3）"
```

---

## 完成标准

六个任务全绿后，对照专项 spec §11 逐条确认：

1. 上下文纳入最近 4 次自我测评摘要，且**不含当次**
2. 对话流全账号一条：换路径、换测评、重新登录都接着上文
3. 服务端是对话的真相源：客户端只发本轮问题，请求体里夹带 `messages` 无效
4. 一轮问答在流正常结束后成对写入；中途出错一条都不写
5. `source='other'` 的测评数据永不进上下文；其对话轮次只在查看该记录时进
6. 解读输出四段，首次测评时「你的变化」段照实说明、不编造对比
7. 主文档四处已同步，版本 v1.3

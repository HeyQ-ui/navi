# Navi 知识库 v1.5：通用知识层与五条路径内容填充 · 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把《中国本科生五条发展路径（精华版）》的素材落进知识库——新增跨路径通用知识层（`common.md`），并为 5 条路径文档补齐 `summary` / `timeline` / `guide` / `risk` 四类内容块。

**Architecture:** `common.md` 与已有的 `boundaries.md` 同构：纯 `:::` 容器序列，编译期进 `KnowledgeBundle.common`，`llm` 层把它作为第 9 段拼进 `<knowledge>`。路径文档在既有的开放块类型契约下新增 `guide`（分时段行动建议）与 `risk`（风险与失败后的时间窗口），`timeline` 收窄为「学期 · 节点」，既有 `myth` / `cost` 原样保留。前端不新增任何组件——未识别类型按 §6.3 降级为富文本。

**Tech Stack:** TypeScript · pnpm workspace · vitest · `marked` + `yaml`（knowledge 包编译期）· Hono + Vercel AI SDK（消费侧）

**Spec:** `docs/superpowers/specs/2026-09-27-navi-career-planning-agent-design.md`（v1.5，§6.1 / §6.2 / §6.3 / §6.4 / §8.5 / §9.2）

**素材：** `docs/中国本科生五条发展路径（精华版）：学期时间线、新生误区、差异、风险与局限.docx`
提取命令（需要时重跑）：`python -c "import docx; d=docx.Document('<路径>'); [print(p.text) for p in d.paragraphs]"`

---

## Global Constraints

- **推荐结果必须由 `core` 的确定性算法得出**，大模型只负责解读与追问。本计划只改内容与上下文拼装，**不得触碰 `packages/core` 的算法**（`weights` / `eligibility` / 推荐逻辑一律不动）。
- **知识库内容不得编造。** 未核实内容标 `status: draft`。素材是文献整合，未与任何院校核实，**5 条路径全部保持 `draft`**（硬性约束 2）。
- **素材里的文献引用一律不进知识库。** 不出现「（田振江和徐闻晴，2022）」这类括号引用。
- **新建块类型不得导致构建失败。** 校验只警告、不阻断（硬性约束 3 / §6.4）。
- **`@block` 注解与 `:::` 容器标记不得进入渲染产物与模型上下文**（§6.3 第 4 条）。编译后 `Block.raw` 与 `Block.html` 里都不许出现字面 `:::`。
- **术语统一为「本学科 / 跨学科」**，与路径 `title`（§6.1 目录）一致。素材里的「本专业 / 跨专业」在写入时改写；对比表表头同理。
- **黄金案例集无需同步**：本计划不改权重、不改题目、不改资格条件（硬性约束 5 的触发条件不成立）。
- 提交信息用中文，遵循 Conventional Commits。**每个 Task 结束跑 `pnpm test` 与 `pnpm lint` 都要绿。**

---

## Review Focus

按「最可能先咬到人」排序。每条都在对应 Task 里有测试钉住：

1. **`common.md` 缺失或为空** → 上下文里**不出现**空的「通用知识」标题。走 §8.5 的条件插入，与「历次自我测评」「此前的对话」同款，而不是留一个空段（Task 3）。
2. **对比表里的 Markdown 表格行**（`|---|---|`）→ 容器解析不把它误认成边界，表格完整落进 `raw`，且 `raw` 里不含字面 `:::`（Task 2）。
3. **内容侧使用一个全新块类型**（如 `case`）→ 构建**不失败**，只按未识别类型原样进产物（硬性约束 3；Task 1）。
4. **`cross-discipline-baoyan` 只有 `myth` 没有 `cost`** → 块缺失不影响其余块，也不影响上下文拼装（块类型契约不强制字段，§6.3 第 2 条；Task 7）。
5. **`boundaries.md` 由 2 条变 3 条** → 既有断言同步更新，防退化（Task 4）。

---

## 文件结构

| 文件 | 责任 | 动作 |
|---|---|---|
| `packages/knowledge/common.md` | 跨路径通用知识：6 条新生误区 + 2 张对比表 | 新建 |
| `packages/knowledge/boundaries.md` | 诚实边界清单，加「考试时间节点的年度差异」 | 修改 |
| `packages/knowledge/src/build.ts` | 编译 `common.md` 进 `bundle.common` | 修改 |
| `packages/knowledge/src/validate.ts` | `KnowledgeBundle` 声明加 `common` | 修改 |
| `packages/core/src/types.ts` | 同上（两处声明必须同时改，否则跨包类型对不上） | 修改 |
| `packages/knowledge/src/build.test.ts` | `common` 编译与真实文件的退化断言 | 修改 |
| `packages/llm/src/context.ts` | 提取 `formatBlocks`，新增 `formatCommon`，拼进系统内容 | 修改 |
| `packages/llm/src/context.test.ts` | 通用知识进上下文 / 为空时不出现 | 修改 |
| `packages/llm/src/index.test.ts`、`apps/api/src/server.test.ts`、`packages/core/src/diagnose.test.ts` | 测试夹具补 `common: []` | 修改 |
| `packages/knowledge/paths/*/index.md` | 5 条路径的 `summary` / `timeline` / `guide` / `risk` | 修改 |

---

### Task 0: 建分支

- [ ] **Step 1: 从 main 切出特性分支**

```bash
git checkout -b feat/knowledge-v1.5
```

预期：`Switched to a new branch 'feat/knowledge-v1.5'`。后续每个 Task 的提交都落在这条分支上。

---

### Task 1: `common` 编译进知识库产物

**Files:**
- Modify: `packages/knowledge/src/validate.ts`（`KnowledgeBundle` 接口）
- Modify: `packages/core/src/types.ts`（`KnowledgeBundle` 接口，约 128–137 行）
- Modify: `packages/knowledge/src/build.ts`
- Modify: `packages/knowledge/src/build.test.ts`
- Modify（补夹具）: `packages/llm/src/context.test.ts:38`、`packages/llm/src/index.test.ts:26`、`apps/api/src/server.test.ts:52`、`packages/core/src/diagnose.test.ts:26` 与 `:127`

**Interfaces:**
- Consumes: `parseContainers` / `parseFrontmatter`（`packages/knowledge/src/parse.ts`，已存在）
- Produces: `KnowledgeBundle.common: Block[]` —— 后续所有 Task 依赖这个字段名

- [ ] **Step 1: 写失败的测试**

在 `packages/knowledge/src/build.test.ts` 末尾追加：

```ts
describe('buildKnowledge · 通用知识（设计文档 §6.1 v1.5）', () => {
  it('根目录没有 common.md 时返回空数组', () => {
    expect(buildKnowledge(makeTempRoot()).common).toEqual([])
  })

  it('解析 common.md 为逐条容器块，raw 里不带字面 :::', () => {
    const root = makeTempRoot()
    writeFileSync(
      join(root, 'common.md'),
      ':::myth 目标真空\n随大流决定考研或考公。\n:::\n\n:::compare 差异对比\n| A | B |\n|---|---|\n| 1 | 2 |\n:::\n',
      'utf8',
    )
    const blocks = buildKnowledge(root).common
    expect(blocks.map(b => b.type)).toEqual(['myth', 'compare'])
    expect(blocks[0]!.title).toBe('目标真空')
    expect(blocks[0]!.raw).toBe('随大流决定考研或考公。')
    expect(blocks[1]!.raw).toContain('| 1 | 2 |')
    expect(blocks.every(b => !b.raw.includes(':::') && !b.html.includes(':::'))).toBe(true)
  })

  it('内容侧写了一个全新块类型时不报错、不丢弃', () => {
    const root = makeTempRoot()
    writeFileSync(join(root, 'common.md'), ':::case 某个案例\n正文\n:::\n', 'utf8')
    const blocks = buildKnowledge(root).common
    expect(blocks).toHaveLength(1)
    expect(blocks[0]!.type).toBe('case')
    expect(blocks[0]!.raw).toBe('正文')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @navi/knowledge test`
预期：FAIL —— `bundle.common is not iterable` / TypeScript 报 `Property 'common' does not exist`。

- [ ] **Step 3: 两处 `KnowledgeBundle` 各加一个字段**

`packages/knowledge/src/validate.ts`，在 `boundaries` 之后：

```ts
  /** 通用知识（设计文档 §6.1）。文件缺失时为空数组 */
  common: Block[]
```

`packages/core/src/types.ts` 同样处理（同一段接口，字段顺序保持一致）：

```ts
  /** 通用知识（设计文档 §6.1）。文件缺失时为空数组 */
  common: Block[]
```

> 两处是各自独立的声明，没有共享类型——只改一处，跨包赋值会在 `pnpm build` 时报 TS2739。

- [ ] **Step 4: `build.ts` 编译 `common.md`**

在 `boundariesPath` 那段之前插入（与 boundaries 同构）：

```ts
  // 通用知识（设计文档 §6.1 v1.5）。同为 `:::` 容器序列，但没有 frontmatter
  const commonPath = join(rootDir, 'common.md')
  const common = existsSync(commonPath)
    ? parseContainers(readFileSync(commonPath, 'utf8'))
    : []
```

返回值改为：

```ts
  return { indicators, questions, archetypes, paths, blocks, common, boundaries }
```

- [ ] **Step 5: 补齐 5 处测试夹具**

每个构造 `KnowledgeBundle` 字面量的地方补 `common: []`，与既有 `boundaries: []` 并排：

- `packages/llm/src/context.test.ts:38` → `common: [],` 加在 `boundaries:` 前一行
- `packages/llm/src/index.test.ts:26` → 同上
- `apps/api/src/server.test.ts:52` → 同上
- `packages/core/src/diagnose.test.ts:26` → 同上
- `packages/core/src/diagnose.test.ts:127` → 同一行的对象字面量里加 `common: [],`

顺带在 `build.test.ts` 的「rootDir 为空目录时返回空结构而不是崩溃」里补一条：

```ts
    expect(bundle.common).toEqual([])
```

- [ ] **Step 6: 跑测试确认通过**

Run: `pnpm test`
预期：PASS。`pnpm --filter @navi/knowledge build` 输出里 5 条路径之外的警告数不变。

- [ ] **Step 7: 提交**

```bash
git add packages/knowledge/src/validate.ts packages/core/src/types.ts packages/knowledge/src/build.ts packages/knowledge/src/build.test.ts packages/llm/src/context.test.ts packages/llm/src/index.test.ts apps/api/src/server.test.ts packages/core/src/diagnose.test.ts
git commit -m "feat(knowledge): 通用知识编译进产物，bundle 新增 common 字段"
```

---

### Task 2: `common.md` 内容

**Files:**
- Create: `packages/knowledge/common.md`

**Interfaces:**
- Consumes: Task 1 的编译通道
- Produces: 8 个块 —— 6 个 `myth` + 2 个 `compare`，供 Task 3 拼进上下文

**素材来源：** docx「二、大一新生常见误区」（6 条）、表 5（差异对比）、表 6（风险对比）；
两段归纳性文字分别取「三、五条路径差异对比」与「四、五条路径风险对比」的首段。

- [ ] **Step 1: 写失败的测试**

在 `build.test.ts` 的「通用知识」describe 里追加：

```ts
  it('真实的 common.md 解析出 6 条误区 + 2 张对比表（防止将来退化时无人报警）', () => {
    const blocks = buildKnowledge().common
    expect(blocks.filter(b => b.type === 'myth')).toHaveLength(6)
    expect(blocks.filter(b => b.type === 'compare')).toHaveLength(2)
    expect(blocks.every(b => b.title !== undefined)).toBe(true)
    expect(blocks.every(b => !b.raw.includes(':::'))).toBe(true)
  })

  it('对比表完整落进 raw，Markdown 表格行不被当成容器边界', () => {
    const tables = buildKnowledge().common.filter(b => b.type === 'compare')
    for (const t of tables) {
      expect(t.raw).toContain('|---')
      expect(t.html).toContain('<table>')
    }
  })
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @navi/knowledge test`
预期：FAIL —— `expected [] to have length 6`（`common.md` 尚不存在）。

- [ ] **Step 3: 写入 `common.md`**

文件**不带 frontmatter**（§6.2 v1.5），整篇是 `:::` 容器序列：

```markdown
:::myth 目标真空、盲目跟风
在尚未了解规则与自身兴趣时，随大流决定「考研 / 考公 / 保研」，或因周围人行动而焦虑性跟进。
:::

:::myth 路径锁定过早或过晚
过早锁死可能错失试错空间；过晚才启动则错过保研、选调这类需要长期积累的窗口。
:::

:::myth 对绩点与规则的信息不对称
不了解推免办法、成绩计算方式与加分项，低年级掉以轻心，后期难以挽回。
:::

:::myth 自主与周末时间利用不足
进入宽松环境后时间管理失序，周末大量荒废，对自主学习认识不够。
:::

:::myth 把「忙碌」当「成长」
参加过多社团或盲目考证，缺乏清晰目标，形式上忙碌而无实质积累。
:::

:::myth 外部动机过早主导
从大一起就被就业升学等外部动机主导，源于求知兴趣的动力相对下降。
:::

:::compare 五条路径差异对比
| 对比维度 | 本学科保研 | 本学科考研 | 跨学科保研 | 跨学科考研 | 考公考编 |
|---|---|---|---|---|---|
| 竞争性质 | 申请考核、名额制 | 开放统考、分数线 | 申请考核、证据门槛高 | 开放统考、复试加试 | 多场次，选调为封闭赛道 |
| 准备周期 | 前三年长期积分 | 约 10–12 个月 | 前三年 + 跨学科证据 | 约 10–12 个月，专业课更重 | 数月至一年，可滚动 |
| 核心能力信号 | 绩点排名、科研、英语 | 初试分数、复试表现 | 本学科绩点 + 目标学科证据 | 初试分数、跨学科能力证明 | 行测申论、政治面貌、岗位匹配 |
| 决战时点 | 大三暑假夏令营 | 大四上 12 月初试 | 大三暑假夏令营 | 大四上 12 月初试 | 大四上 11 月底起多批次 |
| 结果确定性 | 获优秀营员后较高 | 初试后仍需复试 | 受跨学科证据影响 | 复试调剂不确定性高 | 单次命中率低、可再战 |

几条路径的核心差异可以这样看：保研主要看长期积累和与目标院校的匹配程度；考研主要看
单次统考的发挥；跨学科在此之外还要多过两道关，即准入证据和入学后的适应；考公更像耐力战，
看能不能坚持考完一场场考试、选对合适的岗位。

本表覆盖五条升学与体制内路径。本科就业的两条路径（本学科就业、跨学科就业）暂无同源材料，
未纳入对比——不补，也不推测。
:::

:::compare 五条路径风险对比
| 路径 | 主要风险 | 失败后的时间窗口 |
|---|---|---|
| 本学科保研 | 绩点内卷、向下兼容、结果落定晚 | 9–10 月才确定，秋招已过大半 |
| 本学科考研 | 录取率低、复试被刷、多战循环 | 次年 3–4 月出结果，可赶春招尾声 |
| 跨学科保研 | 证据不足、两头不靠、融入难 | 同保研，秋招窗口受限 |
| 跨学科考研 | 自学难、复试加试、调剂受限 | 次年 3–4 月，春招与就业准备更紧 |
| 考公考编 | 上岸率低、多战线冲突、基层适应 | 可参加多场次，但应届红利通常一次 |

几条路径的共性风险，在于只押一条路、信息又不对称，机会成本随之抬高。因此多数研究建议
在升学和就业之间做「双准备」：在必须全力投入的时点（夏令营、初试）到来之前，手里始终
留一个替代方案。
:::
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @navi/knowledge test`
预期：PASS，且 `pnpm --filter @navi/knowledge build` 的警告里**没有** common.md 相关的。

- [ ] **Step 5: 提交**

```bash
git add packages/knowledge/common.md packages/knowledge/src/build.test.ts
git commit -m "feat(knowledge): 新增通用知识 common.md（新生误区与多路径对比）"
```

---

### Task 3: 通用知识进模型上下文

**Files:**
- Modify: `packages/llm/src/context.ts`（`formatCurrentPath` 与 `buildSystemContent`）
- Modify: `packages/llm/src/context.test.ts`

**Interfaces:**
- Consumes: `bundle.common: Block[]`（Task 1）、8 个 common 块（Task 2）
- Produces: `formatBlocks(blocks: Block[]): string`（模块内私有）

- [ ] **Step 1: 写失败的测试**

先在 `context.test.ts` 的 `bundle` 夹具里给 `common` 填上内容（此时该字段已存在）：

```ts
  common: [
    { type: 'myth', title: '目标真空、盲目跟风', html: '<p>随大流决定考研或考公</p>', raw: '随大流决定考研或考公' },
    { type: 'compare', title: '五条路径差异对比', html: '<table></table>', raw: '| 对比维度 | 本学科保研 |' },
  ],
```

再追加一个 describe：

```ts
describe('上下文 · 通用知识（设计文档 §8.5 v1.5）', () => {
  it('带上通用知识，且保留块标题（标题是内容）', () => {
    const content = buildSystemContent(knowledge)
    expect(content).toContain('目标真空、盲目跟风')
    expect(content).toContain('随大流决定考研或考公')
    expect(content).toContain('五条路径差异对比')
  })

  it('通用知识里不带容器标记', () => {
    expect(buildSystemContent(knowledge)).not.toContain(':::')
  })

  it('没有通用知识时整段不出现，而不是留一个空标题', () => {
    const noCommon = { ...knowledge, bundle: { ...bundle, common: [] } }
    const content = buildSystemContent(noCommon)
    expect(content).not.toContain('通用知识')
    expect(content).not.toContain('（无）')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @navi/llm test`
预期：FAIL —— 前两条 `expect(content).toContain('目标真空、盲目跟风')` 失败；第三条失败于「通用知识」字样本就不存在之外还有 `（无）` 断言，按实际报错确认。

- [ ] **Step 3: 提取 `formatBlocks`，让标题逻辑只有一份**

把 `formatCurrentPath` 里那段映射提出来（`Block` 类型从 `@navi/core` 一并导入）：

```ts
/**
 * 块的渲染：保留块标题——标题是内容（如「排名前 10% 就稳了」「目标真空、盲目跟风」），
 * 被剥掉的只有 ::: 标记与块类型（设计文档 §6.3 第 4 条）。
 */
function formatBlocks(blocks: Block[]): string {
  return blocks
    .map(b => (b.title === undefined ? b.raw : `**${b.title}**\n${b.raw}`))
    .join('\n\n')
}

function formatCurrentPath(slice: KnowledgeSlice): string {
  const blocks = slice.bundle.blocks[slice.pathId] ?? []
  if (blocks.length === 0) return '（这条路径暂无正文内容）'
  return formatBlocks(blocks)
}

/** 跨路径通用知识——回答「这几条路差在哪」时的事实来源，不由模型现场归纳 */
function formatCommon(slice: KnowledgeSlice): string | null {
  if (slice.bundle.common.length === 0) return null
  return formatBlocks(slice.bundle.common)
}
```

`formatCommon` 返回 `string | null` 是刻意的：走条件插入，与 `formatHistory` / `formatConversation` 同款，空的时候整段消失。

- [ ] **Step 4: 拼进系统内容**

在 `buildSystemContent` 的返回数组里，「全部路径摘要」之后、「此前的对话」之前插入：

```ts
    '## 全部路径摘要',
    formatAllSummaries(slice),
    ...(commonBlock === null
      ? []
      : ['', '## 通用知识（跨路径共用）', commonBlock]),
```

并在数组之前加一行：

```ts
  const commonBlock = formatCommon(slice)
```

- [ ] **Step 5: 跑测试确认通过**

Run: `pnpm --filter @navi/llm test`
预期：PASS。既有断言「不带其他路径的正文」（`体制内时间线`）仍应通过——通用知识里没有那条路径的正文。

- [ ] **Step 6: 提交**

```bash
git add packages/llm/src/context.ts packages/llm/src/context.test.ts
git commit -m "feat(llm): 通用知识进上下文，块渲染逻辑提取为 formatBlocks"
```

---

### Task 4: 诚实边界补「考试时间节点的年度差异」

**Files:**
- Modify: `packages/knowledge/boundaries.md`
- Modify: `packages/knowledge/src/build.test.ts:73-79`

**素材来源：** docx「五、研究局限」第三条。

- [ ] **Step 1: 更新既有断言（先改测试）**

`build.test.ts` 的「真实的 boundaries.md 解析出两条 boundary 块」改为三条：

```ts
  it('真实的 boundaries.md 解析出三条 boundary 块（防止将来退化时无人报警）', () => {
    const blocks = buildKnowledge().boundaries
    expect(blocks).toHaveLength(3)
    expect(blocks.every(b => b.type === 'boundary')).toBe(true)
    expect(blocks.map(b => b.title)).toEqual([
      'topic="转专业政策"',
      'topic="院校录取分数线预测"',
      'topic="考试时间节点的年度差异"',
    ])
    expect(blocks.every(b => !b.raw.includes(':::'))).toBe(true)
  })
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @navi/knowledge test`
预期：FAIL —— `expected length 2 to be 3`。

- [ ] **Step 3: 追加第三条边界**

`packages/knowledge/boundaries.md` 末尾（保持与既有两条同格式）：

```markdown
:::boundary topic="考试时间节点的年度差异"
本库整理的月份规律基于 2025—2026 年的考试安排。国考、省考、考研初试、推免系统的
具体日期每年都可能调整，各省安排也不一致，我们无法给出对所有人都成立的日历。
建议：以当年教育部、国家公务员局、研招网及各省考试院的官方通知为准。
:::
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @navi/knowledge test`
预期：PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/knowledge/boundaries.md packages/knowledge/src/build.test.ts
git commit -m "feat(knowledge): 诚实边界补考试时间节点的年度差异"
```

---

### Task 5: `same-discipline-baoyan` 内容填充

**Files:**
- Modify: `packages/knowledge/paths/same-discipline-baoyan/index.md`

**素材来源：** docx「（一）本专业保研」第二段（→ `summary`）、风险段（→ `risk`）、表 0（→ `timeline` + `guide`）、表 6 第 1 行（→ `risk` 末条）。

**块顺序固定为** `timeline → guide → myth → cost → risk`：什么时候做 → 做什么 → 别踩什么 → 要放弃什么 → 可能栽在哪。`myth` 与 `cost` 的正文**逐字保留**，只调整位置。

- [ ] **Step 1: 写 `summary`**

frontmatter 里 `summary` 整段换成（`weights` / `eligibility` / `status` / `id` 等一律不动）：

```yaml
summary: >
  本学科保研拼的是前三年的持续积累，可以理解成一场绩点与综合素质的长期积分赛。
  推免资格由学校按前三年综合成绩排名确定，成绩通常占绝对权重，科研、竞赛、英语、
  学生工作等构成加分或区分项。它是一条时间窗口最紧、可逆性最差的路：一旦进入大四上
  学期的正式推免流程，几乎没有回头余地。理工科方向最好在大二下学期就进入科研实验，
  留出足够时间看文献、做实验、写论文；而真正定局，往往在大三暑假的夏令营。
```

- [ ] **Step 2: 写 `timeline` 与 `guide`**

把现有 `timeline` 块的三条 bullet 替换为下面两块：

```markdown
<!-- @block type="timeline" -->
## 本学科保研时间线

- **大一上 · 12月** 四级考试
- **大一下 · 6月** 六级考试
- **大二上** 奖学金评定
- **大二下** 学科竞赛、科研立项
- **大三上** 竞赛、论文节点
- **大三下 · 5-8月** 夏令营通知与参营（决战）
- **大四上 · 9月** 预推免、推免系统开放（决战）
- **大四下** 毕业论文

<!-- @block type="guide" -->
:::guide 分时段行动建议
- **大一上** 读懂本校推免办法（成绩计算、保研率、加分项）；力争高绩点；通过四级
- **大一下** 保持专业前列；通过六级；参加 1-2 个社团或学生组织；了解学科方向
- **大二上** 巩固排名；六级争取高分；争取奖学金
- **大二下** 进入实验室或科研项目；参加学科竞赛（理工科关键起点）
- **大三上** 推动科研出阶段性成果；维持排名；建立目标院校清单
- **大三下** 3-5 月备齐材料（成绩单、排名证明、个人陈述、推荐信、论文、英语证明）；海投报名；6-7 月参营，争取「优秀营员」
- **大四上** 9 月参加预推免补录；系统开放后填报志愿、确认复试与待录取；10 月完成录取
- **大四下** 提前进入导师课题组；完成本科毕业论文
:::
```

- [ ] **Step 3: 追加 `risk` 块**

放在 `cost` 块之后：

```markdown
<!-- @block type="risk" -->
:::risk 这条路的风险
- **绩点内卷与圈层分化**：排名处在边缘（约前 15%–30%）的学生，结果落定前既要刷绩点又要多手准备，处境最煎熬
- **有投入、无发展**：选课与成绩经营中的策略主义，换来的是分数而不是能力
- **向下兼容**：向上竞争受阻时，不少人只能去到层次更低的院校
- **结果落定晚**：9–10 月才确定，一旦失利，秋招黄金期已过大半
:::
```

- [ ] **Step 4: 跑校验与测试**

Run: `pnpm --filter @navi/knowledge build && pnpm test`
预期：构建 0 新增警告；测试 PASS。既有断言 `myth.title === '排名前 10% 就稳了'` 与 `cost.title === '选择保研，需要放弃'` 仍通过（`find` 不依赖顺序）。

- [ ] **Step 5: 提交**

```bash
git add packages/knowledge/paths/same-discipline-baoyan/index.md
git commit -m "feat(knowledge): 本学科保研补齐摘要、时间线、行动指南与风险"
```

---

### Task 6: `same-discipline-kaoyan` 内容填充

**Files:**
- Modify: `packages/knowledge/paths/same-discipline-kaoyan/index.md`

**素材来源：** docx「（二）本专业考研」第二段（→ `summary`）、风险段（→ `risk`）、表 1（→ `timeline` + `guide`）、表 6 第 2 行。

- [ ] **Step 1: 写 `summary`**

```yaml
summary: >
  本学科考研的决战在大四，是一场高强度冲刺，有效备考通常需要 10 到 12 个月。它不看
  本科的绩点排名，只看统考分数与复试表现，因此对绩点不占优的人是一次重开一局的机会。
  考生对科目和流程大多有基本掌握，但数学、英语的复习时间普遍还要提前、还要加码。
  大三下启动、暑假强化、大四上冲刺，是绝大多数人的节奏；冲刺阶段的一百多天，可以
  依据记忆规律在四个科目之间分配时间。
```

- [ ] **Step 2: 替换 `timeline`，新增 `guide`**

现有 `timeline` 的六条 bullet 全部替换：

```markdown
<!-- @block type="timeline" -->
## 本学科考研时间线

- **大一** 四六级
- **大二** 专业基础课
- **大三上** 院校信息搜集
- **大三下 · 3月** 定校，暑假强化（启动）
- **大四上 · 9-12月** 预报名、正式报名、网上确认、初试（决战）
- **大四下 · 2-5月** 成绩、国家线、复试与调剂

<!-- @block type="guide" -->
:::guide 分时段行动建议
- **大一** 打好英语、数学等公共基础；过四六级；确认是否喜欢本学科
- **大二** 数学、英语持续积累；学扎实专业基础课
- **大三上** 初步确定报考层次；搜集考试科目与参考书
- **大三下** 3 月确定目标院校与专业并制定计划；数学、英语基础轮，专业课启动；7-8 月暑假强化（黄金期）
- **大四上** 完成报名与确认；9-11 月提高轮；12 月冲刺；按时参加初试
- **大四下** 估分并准备复试或调剂；出分后参加复试；4-5 月确认录取；同步关注春招兜底
:::
```

- [ ] **Step 3: 追加 `risk` 块（放在 `cost` 之后）**

```markdown
<!-- @block type="risk" -->
:::risk 这条路的风险
- **录取率低**：统考实际约「十录二三」，且招生计划含推免与非全日制名额，竞争比名义数字更高
- **任一环节出问题都会落榜**：单科不过线、复试被刷、调剂信息不对称
- **多战循环**：名校情结、过度自信加上沉没成本，容易把人拖进二战、三战
- **与毕业论文撞车**：大四上学期的备考与写作节奏互相挤占
- **时间窗口**：次年 3–4 月出结果，还能赶上春招尾声，但只剩尾巴
:::
```

- [ ] **Step 4: 跑校验与测试**

Run: `pnpm --filter @navi/knowledge build && pnpm test`
预期：构建 0 新增警告；测试 PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/knowledge/paths/same-discipline-kaoyan/index.md
git commit -m "feat(knowledge): 本学科考研补齐摘要、时间线、行动指南与风险"
```

---

### Task 7: `cross-discipline-baoyan` 内容填充

**Files:**
- Modify: `packages/knowledge/paths/cross-discipline-baoyan/index.md`

**素材来源：** docx「（三）跨专业保研」第二段（→ `summary`）、风险段（→ `risk`）、表 2（→ `timeline` + `guide`）、表 6 第 3 行。

> 本路径**没有 `cost` 块**，这是既有状态，不要顺手补一个。块类型契约不强制字段（§6.3 第 2 条），两个 `myth` 块也原样保留。

- [ ] **Step 1: 写 `summary`**

```yaml
summary: >
  跨学科保研要同时应付两套标准：推免资格仍取决于本学科的成绩排名，目标院校考核的却是
  目标学科的能力证据。这意味着在保住本学科高绩点之外，还得另外搭起一条跨学科的
  证据链——辅修、双学位、目标学科的竞赛或科研。它比本学科保研多两道门槛：目标院系
  是否接收跨学科学生，以及你是否具备对方认可的先修基础。「为什么跨」会被反复追问，
  需要提前有拿得出手的答案。
```

- [ ] **Step 2: 替换 `timeline`，新增 `guide`**

```markdown
<!-- @block type="timeline" -->
## 跨学科保研时间线

- **大一** 选课、四级
- **大二** 辅修或双学位申请
- **大三上** 科研、论文
- **大三下 · 5-8月** 夏令营（决战）
- **大四上 · 9月** 预推免、推免系统开放（决战）
- **大四下** 毕业论文

<!-- @block type="guide" -->
:::guide 分时段行动建议
- **大一** 保持高绩点；通过选课与通识课试探兴趣方向；过四级
- **大二** 申请辅修或系统选修目标学科核心课；参加目标学科相关竞赛或科研
- **大三上** 明确跨学科保研目标；争取目标学科的科研经历或成果，形成证据链
- **大三下** 个人陈述讲清跨学科的动机与证据；海投对跨学科友好的院校（逐个核实政策）；参营
- **大四上** 预推免补录；系统填报与确认；10 月完成录取
- **大四下** 补目标学科基础；提前进组
:::
```

- [ ] **Step 3: 追加 `risk` 块（放在两个 `myth` 块之后）**

```markdown
<!-- @block type="risk" -->
:::risk 这条路的风险
- **证据不够硬**：跨学科证据不足时，很可能在夏令营环节就被拒
- **院校政策收紧**：部分院校对跨学科推免考查更严，甚至直接限制报考
- **两头不靠**：辅修与双学位投入大量时间，可能反过来拉低本学科绩点
- **融入有结构性障碍**：即便顺利入学，学科文化的适应也并非一蹴而就
- **时间窗口**：与保研同期，9–10 月才落定，秋招窗口同样受限
:::
```

- [ ] **Step 4: 跑校验与测试**

Run: `pnpm --filter @navi/knowledge build && pnpm test`
预期：PASS。**额外确认**：这条路径没有 `cost` 块时，`buildKnowledge().blocks['cross-discipline-baoyan']` 仍能正常取到其余块。

- [ ] **Step 5: 提交**

```bash
git add packages/knowledge/paths/cross-discipline-baoyan/index.md
git commit -m "feat(knowledge): 跨学科保研补齐摘要、时间线、行动指南与风险"
```

---

### Task 8: `cross-discipline-kaoyan` 内容填充

**Files:**
- Modify: `packages/knowledge/paths/cross-discipline-kaoyan/index.md`

**素材来源：** docx「（四）跨专业考研」第二段（→ `summary`）、风险段（→ `risk`）、表 3（→ `timeline` + `guide`）、表 6 第 4 行。

- [ ] **Step 1: 写 `summary`**

```yaml
summary: >
  跨学科考研用统考换一个全新的学科方向。它在统考分数面前相对公平，不看你本科的绩点
  排名，代价是目标学科的课程大多要靠自学，复试还可能遇到额外考查。这是转赛道成本较低、
  也最需要提前启动的一条路：门槛看着不高，可自主支配的时间也有利于准备，但基础薄弱、
  精力分散是真实存在的劣势，而且一旦失败会波及就业准备——前期几乎全压在跨考上了。
```

- [ ] **Step 2: 替换 `timeline`，新增 `guide`**

```markdown
<!-- @block type="timeline" -->
## 跨学科考研时间线

- **大一** 兴趣探索、四级
- **大二** 旁听、选修
- **大三上** 定校、查科目
- **大三下 · 3月** 启动，暑假强化
- **大四上 · 10-12月** 报名、初试（决战）
- **大四下 · 3-4月** 复试与加试、调剂

<!-- @block type="guide" -->
:::guide 分时段行动建议
- **大一** 广泛探索兴趣；过四级；若有方向可提前选修相关课程
- **大二** 旁听目标学科核心课；研读目标学科教材；确认跨学科考研的决心
- **大三上** 确定目标学科与院校；查清考试科目（是否考数学、专业课范围）；评估难度
- **大三下** 目标学科专业课从零自学（任务最重）；公共课同步；暑假强化
- **大四上** 核对招生简章对跨学科报考的限制后再报名；12 月参加初试
- **大四下** 准备复试与可能的加试，证明专业能力；调剂难度更大；春招兜底
:::
```

- [ ] **Step 3: 追加 `risk` 块（放在 `cost` 之后）**

```markdown
<!-- @block type="risk" -->
:::risk 这条路的风险
- **信息不对称**：目标学科的考试范围与重点，靠自学很难摸准
- **复试与调剂受限**：可能被要求加试，调剂时跨学科身份更不占优
- **失败波及就业**：前期准备几乎全压在跨考上，一旦落榜，直接就业同样受影响
- **入学后仍需过渡**：学习适应分阶段展开，得自己主导，再借助老师与同学
- **时间窗口**：次年 3–4 月出结果，春招与就业准备比本学科考研更紧
:::
```

- [ ] **Step 4: 跑校验与测试**

Run: `pnpm --filter @navi/knowledge build && pnpm test`
预期：PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/knowledge/paths/cross-discipline-kaoyan/index.md
git commit -m "feat(knowledge): 跨学科考研补齐摘要、时间线、行动指南与风险"
```

---

### Task 9: `civil-service` 内容填充

**Files:**
- Modify: `packages/knowledge/paths/civil-service/index.md`

**素材来源：** docx「（五）考公考编」第二段（→ `summary`）、风险段（→ `risk`）、表 4（→ `timeline` + `guide`）、表 6 第 5 行。

- [ ] **Step 1: 写 `summary`**

```yaml
summary: >
  考公考编没有「一考定胜负」，而是一场持续数月到一年、可以滚动参加的考试序列，单次
  命中率都不高。公共科目是《行政职业能力测验》与《申论》；定向选调另设院校、党员身份、
  学生干部经历等条件，相当于一条封闭赛道，竞争烈度随岗位的地区与层级差异极大。
  它的时间窗口与应届生身份高度绑定，报考前的第一步不是备考，而是确认自己能不能报——
  大量岗位的限制条件会把很多人挡在报名环节之外。
```

- [ ] **Step 2: 替换 `timeline`，新增 `guide`**

```markdown
<!-- @block type="timeline" -->
## 体制内时间线

- **大一** 入党申请、四级
- **大二** 入党培养、社会实践
- **大三上** 系统复习启动
- **大三下** 定向选调条件核对，暑假强化
- **大四上 · 10-12月** 国考报名与笔试、定向选调
- **大四下 · 1-5月** 国考面试、省考联考、事业单位、补录

<!-- @block type="guide" -->
:::guide 分时段行动建议
- **大一** 了解岗位类型；递交入党申请书；争取担任学生干部；过四级
- **大二** 推进入党流程；保持学生干部经历；参加「三支一扶」或社会实践；接触行测申论题型
- **大三上** 厘清国考、省考、选调、事业单位的区别；行测分模块刷题；申论积累
- **大三下** 核对定向选调的院校名单与条件；行测申论系统复习；暑假强化
- **大四上** 完成国考报名与笔试；参加定向或中央选调；关注 12 月的单独省考
- **大四下** 参加国考、选调的面试体检政审；省考、集中选调与事业单位报考；关注补录
:::
```

- [ ] **Step 3: 追加 `risk` 块（放在 `cost` 之后）**

```markdown
<!-- @block type="risk" -->
:::risk 这条路的风险
- **单次上岸率极低**：热门岗位常有数千人竞争同一个职位；基层冷门岗位竞争小些，但条件艰苦
- **报考限制多**：专业、政治面貌、应届生身份都可能把岗位挡掉，许多岗位仅限应届
- **多战线冲突**：国考、省考、选调、事业单位同时备考，时间上互相挤占
- **基层适应**：选调生进入基层后，要面对机制、环境与身份认同上的调整
- **时间窗口**：可以参加多场次、滚动再战，但应届生身份的红利通常只能用一次
:::
```

- [ ] **Step 4: 跑校验与测试**

Run: `pnpm --filter @navi/knowledge build && pnpm test`
预期：PASS。

- [ ] **Step 5: 全量验收**

Run: `pnpm build && pnpm lint && pnpm test`
预期：三条命令全绿。

然后目视检查产物：

```bash
node -e "const b=require('./packages/knowledge/dist/knowledge.json'); console.log('common:', b.common.length); for (const [id, bl] of Object.entries(b.blocks)) console.log(id, bl.map(x=>x.type).join(','))"
```

预期类似：

```
common: 8
civil-service timeline,guide,myth,cost,risk
cross-discipline-baoyan timeline,guide,myth,myth,risk
cross-discipline-job ...
cross-discipline-kaoyan timeline,guide,myth,cost,risk
same-discipline-baoyan timeline,guide,myth,cost,risk
same-discipline-job ...
same-discipline-kaoyan timeline,guide,myth,cost,risk
```

两条就业路径保持原样（本计划不含素材）。确认产物里**没有任何** `:::`。

- [ ] **Step 6: 提交**

```bash
git add packages/knowledge/paths/civil-service/index.md
git commit -m "feat(knowledge): 考公考编补齐摘要、时间线、行动指南与风险"
```

---

## Self-Review

**Spec 覆盖**

| Spec 要求 | 落点 |
|---|---|
| §6.1 `common.md` 进目录结构、编译进产物 | Task 1、Task 2 |
| §6.2 通用文件不带 frontmatter | Task 2 Step 3 |
| §6.3 块类型开放、新增不阻断构建 | Task 1 Step 1 第 3 条测试 |
| §6.3 第 4 条标记不外泄 | Task 2 Step 1、Task 3 Step 1 |
| §6.4 `common.md` → `bundle.common` | Task 1 Step 4 |
| §6.4 渲染映射增 `guide` / `risk` | 内容侧落 Task 5–9；组件明确不做 |
| §8.4 诚实边界 | Task 4 |
| §8.5 通用知识进上下文（第 9 部分） | Task 3 |
| §9.2 组件清单 | 文档已改；组件不做，符合确认结论 |

**类型一致性**

- `KnowledgeBundle.common: Block[]` —— `validate.ts` 与 `core/types.ts` 两处同名同型（Task 1 Step 3）
- `formatBlocks(blocks: Block[]): string` —— 只此一处定义，`formatCurrentPath` 与 `formatCommon` 共用（Task 3 Step 3）
- `formatCommon(slice): string | null` —— 与 `formatHistory` / `formatConversation` 同签名风格（Task 3 Step 3）
- 块类型字符串全程为 `timeline` / `guide` / `myth` / `cost` / `risk` / `compare` / `boundary`，无别名

**未覆盖的已知缺口**

- 两条就业路径无同源素材，保持原样。已在 `common.md` 的对比表正文里显式声明，避免模型对着 5 行表格推 7 条路径。
- 前端组件不做（用户已确认）。内容在界面上是富文本，在模型上下文里与其它块同等。

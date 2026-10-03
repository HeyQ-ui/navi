# 测评题目内容与升学意向算法改动 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按《软件修改02-题目内容和算法》改题目内容，并用一道「升学意向」题（一题两指标）替代已删除的 `gpa-competitiveness` 分项。

**Architecture:** 知识库题目格式扩展出可选 `scores` 字段（每个选项对若干指标给出分值），`core` 的 `computeIndicatorScores` 按 `scores` 取值；不带 `scores` 的老题目继续走五档位置映射。删掉 `gpa-competitiveness` 指标与 5 道题，其在大一视角留下的 `freshman-3`（落后时的行动反应）改挂 `accumulation-drive`；三条保研/考研路径权重里的绩点分项换成「保研意愿 / 考研意愿」。推荐结果仍由确定性算法得出，大模型不参与。

**Tech Stack:** TypeScript · pnpm workspace · vitest · YAML 知识库

**Spec:** `软件修改02-题目内容和算法.txt`（仓库根，未纳入 git）+ `docs/superpowers/specs/2026-09-27-navi-career-planning-agent-design.md`

## Global Constraints

- 推荐结果必须由 `packages/core` 的确定性算法得出，大模型不参与决策（AGENTS.md 硬性约束 1）。
- 知识库内容不得编造；未核实内容标 `status: draft`（AGENTS.md 硬性约束 2）。
- `packages/core` 不得引入框架依赖、不得发网络请求、不得依赖 `llm`/`api`/`web`（模块边界）。
- 涉及推荐逻辑的改动必须同步更新黄金案例集（AGENTS.md 硬性约束 5）。
- 提交信息用中文，遵循 Conventional Commits。
- 设计文档是唯一真相源：算法与格式变更必须同步写进 `2026-09-27-navi-career-planning-agent-design.md`，不在其他文档重述设计。

## 编号对照（本计划所用，按大一视角的文件名排序）

| 用户编号 | 文件 | 改动 |
|---|---|---|
| 第四题 | `accumulation-drive-1` | 选项 4/5 去重 |
| 第五题 | `accumulation-drive-2` | 题干改「你过去的大学生活中…」 |
| 第十三题 | `eligibility-tuimian-quota` | 4 选项，3/4 合并 |
| 第十四题 | `gpa-competitiveness-freshman-1` | 删 |
| 第十五题 | `gpa-competitiveness-freshman-2` | 删 |
| — | `gpa-competitiveness-freshman-3` | 改名 `accumulation-drive-4`，改挂积累行动力 |
| — | `gpa-competitiveness-senior-1/2/3` | 删 |
| 第十九题 | `public-affairs-leaning-3` | 选项 3 换「没仔细想过」 |
| 第二十二题 | `risk-preference-3` | 删（与新增题合并为 `grad-intention-1`） |
| 第二十四题 | `stress-endurance-2` | 选项 3 换「不知道自己会怎么做」 |

## 意向题的判定表（方案 A）

| 选项 | `grad-intention-baoyan` | `grad-intention-kaoyan` | `grad-intention-none` |
|---|---|---|---|
| 想走保研 | 100 | 0 | 0 |
| 想走考研 | 0 | 100 | 0 |
| 不打算读研 | 0 | 0 | 100 |
| 还没想好 | 无信息（该选项不写指标） | 无信息 | 无信息 |

三个指标各自只有这一道题，互相排斥：选一条就只在那一条对应的路径上拿满分，另外两条拿 0 分。挂载关系：

| 指标 | 挂到哪几条路径（`ideal: 100`） |
|---|---|
| `grad-intention-baoyan` | 本学科保研 0.35、跨学科保研 0.30 |
| `grad-intention-kaoyan` | 本学科考研 0.25、跨学科考研 0.20 |
| `grad-intention-none` | 本学科就业 0.25、跨学科就业 0.25、考公考编 0.20 |

「还没想好」→ 三个指标都 `known: false` → `normalizeWeights` 把这三个分项一并剔除并按剩余权重重归一化（现成机制），因此对任何路径都不加分、不减分。

## Review Focus

- **选项越界**：`answer >= question.options.length` 在 N 选项题上必须视为未作答，不能拿 `FIVE_POINT_SCALE` 的 5 档去索引（4 选项题写 `scores: []` 长度为 4）。
- **资格判断题的选项下标**：`passWhen` 指向的是选项下标，合并选项后必须同步改，否则保研路径对**所有人**静默失效。
- **陈旧 localStorage**：题目 id 删除后，客户端整包提交会被 `/api/diagnose` 的未知 id 校验拒成 400。
- **「还没想好」被当成 0 分**：该选项必须完全不产生分值（不是 0 分），否则三条路径会被扣分，形成用户没表达的负向判断。
- **「不打算读研」被当成「无意愿」**：它是三个互斥指标里的满分项，必须真的抬高就业与考公路径、同时把两条升学路径压到 0 分。
- **黄金案例集漂移**：删题/换权重会改变 `match`，`expectTopPath` 变化必须逐条解释成因，不得整体重录。

---

### Task 1: core 支持「一题多指标」

**Files:**
- Modify: `packages/core/src/types.ts`（`IndicatorId` 联合、`Question`）
- Modify: `packages/core/src/scoring.ts`
- Test: `packages/core/src/scoring.test.ts`
- Modify: `packages/core/src/matching.test.ts`、`packages/core/src/weights.test.ts`、`packages/llm/src/context.test.ts`（示例数据里的 `gpa-competitiveness` 换成留存指标，否则联合类型改动后编译失败）

**Interfaces:**
- Consumes: 无
- Produces: `Question.indicator?: IndicatorId`、`Question.scores?: Record<string, number>[]`；`computeIndicatorScores(answers, questions, indicators)` 签名不变，新增「带 `scores` 的题」与「无信息选项」语义。

- [ ] **Step 1: 写失败测试**

在 `packages/core/src/scoring.test.ts` 追加：

```ts
describe('一题多指标（scores 字段）', () => {
  const indicators = [
    { id: 'grad-intention-baoyan' as const, name: '保研意愿' },
    { id: 'grad-intention-kaoyan' as const, name: '考研意愿' },
  ]
  const question = {
    id: 'grad-intention-1',
    text: '毕业后的去向？',
    options: ['保研', '考研', '不读研', '还没想好'],
    weight: 1,
    scores: [
      { 'grad-intention-baoyan': 100, 'grad-intention-kaoyan': 0 },
      { 'grad-intention-baoyan': 0, 'grad-intention-kaoyan': 100 },
      { 'grad-intention-baoyan': 0, 'grad-intention-kaoyan': 0 },
      {},
    ],
  }

  it('按选项给出各指标的分值', () => {
    const s = computeIndicatorScores({ 'grad-intention-1': 1 }, [question], indicators)
    expect(s['grad-intention-baoyan']!.score).toBe(0)
    expect(s['grad-intention-kaoyan']!.score).toBe(100)
  })

  it('「不读研」两条路径都得 0 分', () => {
    const s = computeIndicatorScores({ 'grad-intention-1': 2 }, [question], indicators)
    expect(s['grad-intention-baoyan']!.score).toBe(0)
    expect(s['grad-intention-kaoyan']!.score).toBe(0)
  })

  it('「还没想好」不产生分值，指标未已知', () => {
    const s = computeIndicatorScores({ 'grad-intention-1': 3 }, [question], indicators)
    expect(s['grad-intention-baoyan']!.known).toBe(false)
    expect(s['grad-intention-kaoyan']!.known).toBe(false)
  })

  it('选项越界视为未作答', () => {
    const s = computeIndicatorScores({ 'grad-intention-1': 9 }, [question], indicators)
    expect(s['grad-intention-baoyan']!.known).toBe(false)
  })

  it('4 选项题不会拿五档表去索引', () => {
    const q4 = { ...question, scores: [{ x: 100 }, { x: 75 }, { x: 50 }, {}] }
    const s = computeIndicatorScores({ 'grad-intention-1': 3 }, [q4], indicators)
    expect(s['grad-intention-baoyan']!.known).toBe(false)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @navi/core test scoring`
Expected: FAIL —— `scores` 字段不存在（TS 报错）或分值不是 100/0。

- [ ] **Step 3: 改类型**

`packages/core/src/types.ts`：

```ts
export type IndicatorId =
  | 'academic-interest'
  | 'discipline-identity'
  | 'cost-tolerance'
  | 'risk-preference'
  | 'stress-endurance'
  | 'public-affairs-leaning'
  | 'accumulation-drive'
  | 'grad-intention-baoyan'
  | 'grad-intention-kaoyan'
```

```ts
export interface Question {
  id: string
  /** 单指标题：所有选项按五档位置映射到该指标。带 scores 的题不写这个字段 */
  indicator?: IndicatorId
  text: string
  options: string[]
  weight: number
  grades?: string[]
  /** 每选项对若干指标的分值；该选项没写某指标 = 这道题对该指标没有信息 */
  scores?: Record<string, number>[]
}
```

- [ ] **Step 4: 改评分**

`packages/core/src/scoring.ts` 中 `computeIndicatorScores` 换成：

```ts
/** 该题是否参与某指标计分：weight>0 且题面确实携带这个指标 */
function measures(question: Question, indicatorId: string): boolean {
  if (question.weight <= 0) return false
  if (question.scores !== undefined) {
    return question.scores.some(s => s[indicatorId] !== undefined)
  }
  return question.indicator === indicatorId
}

/** 某选项对该指标的分值；未作答、越界、或该选项没写这个指标时为 undefined（无信息） */
function valueFor(
  question: Question,
  indicatorId: string,
  answer: number | undefined,
): number | undefined {
  if (answer === undefined || !Number.isInteger(answer)) return undefined
  // 边界用 options.length 而不是五档表长度：4 选项题的下标 3 是合法作答
  if (answer < 0 || answer >= question.options.length) return undefined

  if (question.scores !== undefined) return question.scores[answer]?.[indicatorId]
  if (answer >= FIVE_POINT_SCALE.length) return undefined
  return FIVE_POINT_SCALE[answer]
}

export function computeIndicatorScores(
  answers: Answers,
  questions: Question[],
  indicators: IndicatorDef[],
): Record<string, IndicatorScore> {
  const result: Record<string, IndicatorScore> = {}

  for (const indicator of indicators) {
    const applicable = questions.filter(q => measures(q, indicator.id))
    const answered = applicable.flatMap(q => {
      const value = valueFor(q, indicator.id, answers[q.id])
      return value === undefined ? [] : [{ question: q, value }]
    })

    if (answered.length === 0) {
      result[indicator.id] = { score: 0, known: false, consistency: 0, sources: [] }
      continue
    }

    const totalWeight = answered.reduce((s, a) => s + a.question.weight, 0)
    const scores = answered.map(a => a.value)
    const score = answered.reduce((s, a) => s + a.value * a.question.weight, 0) / totalWeight

    result[indicator.id] = {
      score,
      known: true,
      consistency: consistencyOf(scores),
      sources: answered.map(a => a.question.id),
    }
  }

  return result
}
```

- [ ] **Step 5: 修示例数据里的旧指标 id**

`packages/core/src/matching.test.ts`、`packages/core/src/weights.test.ts`、`packages/llm/src/context.test.ts` 中把 `'gpa-competitiveness'` 全部替换为 `'discipline-identity'`（数组/期望按新指标名同步），不要留任何 `gpa-competitiveness`：

Run: `grep -rn "gpa-competitiveness" packages/ apps/`

- [ ] **Step 6: 跑全量测试**

Run: `pnpm test`
Expected: PASS（黄金案例此时应仍通过，Task 5 前不动它）。

- [ ] **Step 7: 提交**

```bash
git add packages/core/src/types.ts packages/core/src/scoring.ts packages/core/src/scoring.test.ts packages/core/src/matching.test.ts packages/core/src/weights.test.ts packages/llm/src/context.test.ts
git commit -m "feat(core): 题目支持一题多指标，选项可对指标无信息"
```

---

### Task 2: 知识库校验支持新题目格式

**Files:**
- Modify: `packages/knowledge/src/validate.ts`
- Test: `packages/knowledge/src/validate.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `Question.scores` 语义
- Produces: `QuestionDef.indicator?: string`、`QuestionDef.scores?: Record<string, number>[]`；`validateKnowledge(bundle)` 返回的告警文案

- [ ] **Step 1: 写失败测试**

在 `packages/knowledge/src/validate.test.ts` 的 `describe` 内追加（该文件顶部已有 `bundle(overrides)` 这一 fixture 工厂，直接复用）：

```ts
it('带 scores 的题不受「必须 5 个选项」约束', () => {
  const warnings = validateKnowledge(bundle({
    questions: [{
      id: 'grad-intention-1', text: '？', weight: 1,
      options: ['保研', '考研', '不读研', '还没想好'],
      scores: [
        { 'grad-intention-baoyan': 100, 'grad-intention-kaoyan': 0 },
        { 'grad-intention-baoyan': 0, 'grad-intention-kaoyan': 100 },
        {}, {},
      ],
    }],
    indicators: [
      { id: 'academic-interest', name: '学术志趣' },
      { id: 'grad-intention-baoyan', name: '保研意愿' },
      { id: 'grad-intention-kaoyan', name: '考研意愿' },
    ],
  }))
  expect(warnings.join()).not.toContain('个选项')
})

it('scores 与 options 长度不一致要告警', () => {
  const warnings = validateKnowledge(bundle({
    questions: [{
      id: 'grad-intention-1', text: '？', weight: 1,
      options: ['a', 'b', 'c'],
      scores: [{ 'grad-intention-baoyan': 1 }, { 'grad-intention-baoyan': 2 }],
    }],
    indicators: [{ id: 'grad-intention-baoyan', name: '保研意愿' }],
  }))
  expect(warnings.join()).toContain('scores')
})

it('只有多指标题的指标豁免「至少 3 道题」', () => {
  const warnings = validateKnowledge(bundle({
    questions: [{
      id: 'grad-intention-1', text: '？', weight: 1,
      options: ['a', 'b', 'c', 'd'],
      scores: [{ 'grad-intention-baoyan': 100 }, {}, {}, {}],
    }],
    indicators: [{ id: 'grad-intention-baoyan', name: '保研意愿' }],
  }))
  expect(warnings.join()).not.toContain('少于要求的')
})
```

（这两个用例里 `bundle()` 还会带出「路径权重引用了不存在的指标 academic-interest」之类的告警——断言只针对本用例要钉的那一条，不要写成 `toEqual([])`。）

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @navi/knowledge test validate`
Expected: FAIL —— 4 选项题报「应为 5 个」，1 道题的指标报「少于要求的 3 道」。

- [ ] **Step 3: 实现**

`packages/knowledge/src/validate.ts`：

```ts
export interface QuestionDef {
  id: string
  /** 单指标题；带 scores 的题不写 */
  indicator?: string
  text: string
  options: string[]
  weight: number
  grades?: string[]
  scores?: Record<string, number>[]
}
```

「至少 3 道题」循环改为：

```ts
for (const indicator of bundle.indicators) {
  // 多指标题（带 scores）构成的指标由一道题同时供给多个维度，
  // 「至少 3 道」对它不适用（设计文档 §7.1 的约束针对单指标题）
  const multi = bundle.questions.some(
    q => q.scores?.some(s => s[indicator.id] !== undefined) === true,
  )
  if (multi) continue

  const count = bundle.questions.filter(q => q.indicator === indicator.id).length
  if (count < MIN_QUESTIONS_PER_INDICATOR) {
    warnings.push(
      `指标 ${indicator.id} 仅有 ${count} 道题，少于要求的 ${MIN_QUESTIONS_PER_INDICATOR} 道（设计文档 §7.1）`,
    )
  }
}
```

逐题校验改为：

```ts
for (const question of bundle.questions) {
  if (question.scores === undefined) {
    if (question.indicator === undefined) {
      warnings.push(`题目 ${question.id} 既没有 indicator 也没有 scores`)
    } else if (!indicatorIds.has(question.indicator)) {
      warnings.push(`题目 ${question.id} 引用了不存在的指标 ${question.indicator}`)
    }
    if (question.options.length !== 5) {
      warnings.push(`题目 ${question.id} 有 ${question.options.length} 个选项，应为 5 个（设计文档 §5.2）`)
    }
    continue
  }

  if (question.scores.length !== question.options.length) {
    warnings.push(
      `题目 ${question.id} 的 scores 有 ${question.scores.length} 项，与 ${question.options.length} 个选项不一致`,
    )
  }
  for (const optionScores of question.scores) {
    for (const id of Object.keys(optionScores)) {
      if (!indicatorIds.has(id)) {
        warnings.push(`题目 ${question.id} 的 scores 引用了不存在的指标 ${id}`)
      }
    }
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @navi/knowledge test`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/knowledge/src/validate.ts packages/knowledge/src/validate.test.ts
git commit -m "feat(knowledge): 校验支持 N 选项与一题多指标"
```

---

### Task 3: 题目内容改动

**Files:**
- Modify: `packages/knowledge/questions/accumulation-drive-1.yaml`
- Modify: `packages/knowledge/questions/accumulation-drive-2.yaml`
- Modify: `packages/knowledge/questions/eligibility-tuimian-quota.yaml`
- Modify: `packages/knowledge/questions/public-affairs-leaning-3.yaml`
- Modify: `packages/knowledge/questions/stress-endurance-2.yaml`
- Create: `packages/knowledge/questions/accumulation-drive-4.yaml`
- Create: `packages/knowledge/questions/grad-intention-1.yaml`
- Create: `packages/knowledge/questions/risk-preference-4.yaml`
- Delete: `packages/knowledge/questions/gpa-competitiveness-freshman-1.yaml`、`-freshman-2.yaml`、`-freshman-3.yaml`、`-senior-1.yaml`、`-senior-2.yaml`、`-senior-3.yaml`、`risk-preference-3.yaml`

**Interfaces:**
- Consumes: Task 1/2 的 `scores` 格式
- Produces: 题目 id `grad-intention-1`（被 Task 4 的路径权重引用）、`accumulation-drive-4`、`risk-preference-4`

- [ ] **Step 1: 第四题去重（`accumulation-drive-1.yaml`）**

```yaml
id: accumulation-drive-1
indicator: accumulation-drive
weight: 1
text: 一个你感兴趣的竞赛或项目通知出现时，你更可能：
options:
  - 看看就算了
  - 想去，但大概率不会报名
  - 会犹豫，需要有人拉一把
  - 会先报上名，再安排准备
  - 会立刻开始准备，不等别人催
```

- [ ] **Step 2: 第五题题干（`accumulation-drive-2.yaml`）**

只改 `text`，选项不动：

```yaml
text: 你过去的大学生活中，除了课程要求，你主动做过的事（自学技能、做项目、参加社团、兼职等）：
```

- [ ] **Step 3: 第十三题合并选项（`eligibility-tuimian-quota.yaml`）**

```yaml
id: eligibility-tuimian-quota
indicator: academic-interest
weight: 0
text: 你的学校是否具备推免资格（也就是通常说的保研名额）？
options:
  - 有，学校有推免名额
  - 没有推免资格
  - 不清楚，或者没听说过推免这回事
  - 我确定有，而且我们专业名额不少
```

（`weight: 0`，不参与计分，因此不需要 `scores`。下标变了：Task 4 必须把 `passWhen` 从 `[0, 4]` 改成 `[0, 3]`。）

- [ ] **Step 4: 第十九题选项 3（`public-affairs-leaning-3.yaml`）**

```yaml
options:
  - 成长速度和个人上限
  - 收入和自由度
  - 没仔细想过
  - 稳定性和保障
  - 稳定压倒一切
```

- [ ] **Step 5: 第二十四题选项 3（`stress-endurance-2.yaml`）**

```yaml
options:
  - 很难坚持，容易放弃
  - 能撑一阵，但会越来越懈怠
  - 不知道自己会怎么做
  - 会自己找阶段性的小目标
  - 能稳定推进，不太受反馈影响
```

- [ ] **Step 6: 保留 freshman-3，改挂积累行动力**

删除 `gpa-competitiveness-freshman-3.yaml`，新建 `accumulation-drive-4.yaml`（选项原文照搬，只换 id 与 indicator）：

```yaml
id: accumulation-drive-4
indicator: accumulation-drive
weight: 1
grades: [freshman]
text: 第一次期中考试后，如果发现有一门课排在班级后半段，你会：
options:
  - 觉得可能自己就是这个水平
  - 有点焦虑，但不知道怎么办
  - 会想想问题出在哪
  - 会去找方法补上
  - 会立刻调整学习方式，并在下次验证
```

- [ ] **Step 7: 新增意向题（`grad-intention-1.yaml`）**

```yaml
id: grad-intention-1
weight: 1
text: 毕业后的去向，你现在的想法更接近哪一种？
options:
  - 想走保研：平时把绩点和排名冲上去，争取学校的推免名额
  - 想走考研：大三大四集中突击，考进心仪的研究生院
  - 不打算读研：毕业后直接就业或考公
  - 还没想好
scores:
  - { grad-intention-baoyan: 100, grad-intention-kaoyan: 0, grad-intention-none: 0 }
  - { grad-intention-baoyan: 0, grad-intention-kaoyan: 100, grad-intention-none: 0 }
  - { grad-intention-baoyan: 0, grad-intention-kaoyan: 0, grad-intention-none: 100 }
  - {}
```

（不写 `indicator`：这道题由 `scores` 供给三个指标，对所有年级通用。）

- [ ] **Step 8: 补回第二大题之后的风险偏好题（`risk-preference-4.yaml`）**

`risk-preference-3` 合并进意向题后被删除，风险偏好只剩 2 道题，低于「每指标至少 3 道」，故新增一道：

```yaml
id: risk-preference-4
indicator: risk-preference
weight: 1
text: 面对两条路：一条前景更好但要重新开始，另一条平平但确定能走通。你会：
options:
  - 一定选确定能走通的那条
  - 倾向确定的那条
  - 说不准，要看具体差多少
  - 倾向前景更好的那条
  - 一定选前景更好的那条
```

- [ ] **Step 9: 删题并重建知识库**

```bash
git rm packages/knowledge/questions/gpa-competitiveness-freshman-1.yaml \
       packages/knowledge/questions/gpa-competitiveness-freshman-2.yaml \
       packages/knowledge/questions/gpa-competitiveness-freshman-3.yaml \
       packages/knowledge/questions/gpa-competitiveness-senior-1.yaml \
       packages/knowledge/questions/gpa-competitiveness-senior-2.yaml \
       packages/knowledge/questions/gpa-competitiveness-senior-3.yaml \
       packages/knowledge/questions/risk-preference-3.yaml
pnpm --filter @navi/knowledge build
```

Expected: 打印「已编译 7 条路径、9 个指标、N 道题目，0 条警告」。（此时 `gpa-competitiveness` 指标文件与路径权重还没改，故可能出现「指标 gpa-competitiveness 仅有 0 道题」与「路径权重引用不存在的指标」——这些由 Task 4 收掉；本步只需确认**新题格式**没有告警。）

- [ ] **Step 10: 提交**

```bash
git add packages/knowledge/questions
git commit -m "feat(knowledge): 题目内容修订，新增升学意向题"
```

---

### Task 4: 指标与路径权重

**Files:**
- Create: `packages/knowledge/indicators/grad-intention-baoyan.yaml`、`grad-intention-kaoyan.yaml`、`grad-intention-none.yaml`
- Delete: `packages/knowledge/indicators/gpa-competitiveness.yaml`
- Modify: `packages/knowledge/paths/same-discipline-baoyan/index.md`、`cross-discipline-baoyan/index.md`、`same-discipline-kaoyan/index.md`、`cross-discipline-kaoyan/index.md`、`same-discipline-job/index.md`、`cross-discipline-job/index.md`、`civil-service/index.md`
- Modify: `packages/knowledge/archetypes/*.yaml`（6 个，删 `gpa-competitiveness` 向量项）

**Interfaces:**
- Consumes: Task 3 的 `grad-intention-1`、Task 1 的 `IndicatorId` 新成员
- Produces: 路径 `weights[].indicator` 使用 `grad-intention-baoyan` / `grad-intention-kaoyan` / `grad-intention-none`

- [ ] **Step 1: 新增三个指标**

`indicators/grad-intention-baoyan.yaml`：

```yaml
id: grad-intention-baoyan
name: 保研意愿
description: 学生自己表达的保研倾向。它是意愿而非能力评估，取代原先的绩点竞争力
```

`indicators/grad-intention-kaoyan.yaml`：

```yaml
id: grad-intention-kaoyan
name: 考研意愿
description: 学生自己表达的考研倾向。它是意愿而非能力评估，取代原先的绩点竞争力
```

`indicators/grad-intention-none.yaml`：

```yaml
id: grad-intention-none
name: 不读研意愿
description: 学生自己表达的「毕业即工作」倾向，供就业与考公路径使用。它同样是意愿而非能力评估
```

- [ ] **Step 2: 删指标、清画像向量**

```bash
git rm packages/knowledge/indicators/gpa-competitiveness.yaml
grep -rln 'gpa-competitiveness' packages/knowledge/archetypes/
```

逐个删掉 6 个 archetype 文件 `vector:` 下的 `gpa-competitiveness: <数>` 一行（`ambitious-striver`、`cautious-generalist`、`civil-service-bound`、`pragmatic-builder`、`steady-scholar`、`undecided-explorer`）。

- [ ] **Step 3: 换保研路径的绩点分项**

`paths/same-discipline-baoyan/index.md`：

```yaml
  - { indicator: grad-intention-baoyan, weight: 0.35, ideal: 100 }
```
（替换原 `- { indicator: gpa-competitiveness, weight: 0.35, ideal: 90 }`，其余四项不动，合计仍为 1.00）

`paths/cross-discipline-baoyan/index.md`：

```yaml
  - { indicator: grad-intention-baoyan, weight: 0.30, ideal: 100 }
```
（替换原 0.30/90 那行）

- [ ] **Step 4: 换考研路径的绩点分项**

`paths/same-discipline-kaoyan/index.md` 的 weights 段整体换成：

```yaml
weights:
  - { indicator: stress-endurance, weight: 0.20, ideal: 80 }
  - { indicator: academic-interest, weight: 0.25, ideal: 70 }
  - { indicator: risk-preference, weight: 0.20, ideal: 40 }
  - { indicator: grad-intention-kaoyan, weight: 0.25, ideal: 100 }
  - { indicator: cost-tolerance, weight: 0.10, ideal: 50 }
```

`paths/cross-discipline-kaoyan/index.md` 的 weights 段整体换成：

```yaml
weights:
  - { indicator: discipline-identity, weight: 0.20, ideal: 25 }
  - { indicator: stress-endurance, weight: 0.20, ideal: 85 }
  - { indicator: risk-preference, weight: 0.20, ideal: 35 }
  - { indicator: accumulation-drive, weight: 0.20, ideal: 75 }
  - { indicator: grad-intention-kaoyan, weight: 0.20, ideal: 100 }
```

- [ ] **Step 5: 给非升学路径挂「不读研意愿」**

`paths/same-discipline-job/index.md`：

```yaml
weights:
  - { indicator: accumulation-drive, weight: 0.25, ideal: 85 }
  - { indicator: grad-intention-none, weight: 0.25, ideal: 100 }
  - { indicator: academic-interest, weight: 0.15, ideal: 30 }
  - { indicator: risk-preference, weight: 0.15, ideal: 55 }
  - { indicator: discipline-identity, weight: 0.10, ideal: 70 }
  - { indicator: cost-tolerance, weight: 0.10, ideal: 25 }
```

`paths/cross-discipline-job/index.md`：

```yaml
weights:
  - { indicator: accumulation-drive, weight: 0.25, ideal: 90 }
  - { indicator: discipline-identity, weight: 0.25, ideal: 25 }
  - { indicator: grad-intention-none, weight: 0.25, ideal: 100 }
  - { indicator: risk-preference, weight: 0.15, ideal: 50 }
  - { indicator: academic-interest, weight: 0.10, ideal: 25 }
```

`paths/civil-service/index.md`：

```yaml
weights:
  - { indicator: public-affairs-leaning, weight: 0.35, ideal: 85 }
  - { indicator: grad-intention-none, weight: 0.20, ideal: 100 }
  - { indicator: risk-preference, weight: 0.20, ideal: 80 }
  - { indicator: stress-endurance, weight: 0.15, ideal: 75 }
  - { indicator: academic-interest, weight: 0.10, ideal: 30 }
```

（三条都保持合计 1.00；`ideal` 沿用原值，只有权重按新分项调开。）

- [ ] **Step 6: 修 `passWhen`（否则保研路径对所有人静默失效）**

`paths/same-discipline-baoyan/index.md` 与 `paths/cross-discipline-baoyan/index.md` 两处：

```yaml
    passWhen: [0, 3]
```
（原为 `[0, 4]`；合并选项后「我确定有推免名额」的下标是 3）

- [ ] **Step 7: 校验**

Run: `pnpm --filter @navi/knowledge build`
Expected: 0 条警告，指标数为 10（原 8 个，删 1 增 3）。

- [ ] **Step 8: 用一次真实诊断确认资格判断没塌**

Run: `pnpm --filter @navi/core test` 后另起 `node -e` 调 `diagnose`：对 `eligibility-tuimian-quota: 3` 的作答，`same-discipline-baoyan` 必须 `eligibility.applicable === true`；对 `1`（没有推免资格）必须 `false`。

- [ ] **Step 9: 提交**

```bash
git add packages/knowledge/indicators packages/knowledge/paths packages/knowledge/archetypes
git commit -m "feat(knowledge): 绩点竞争力分项换成保研/考研意愿"
```

---

### Task 5: 黄金案例集更新

**Files:**
- Modify: `packages/core/src/fixtures/golden-cases.ts`
- Test: `packages/core/src/golden.test.ts`

**Interfaces:**
- Consumes: Task 3 的题目 id、Task 4 的路径权重
- Produces: 三个案例的 `answers` 与 `expectTopPath`

- [ ] **Step 1: 先跑，看哪些案例变了**

Run: `pnpm --filter @navi/core test golden`
Expected: FAIL —— 旧 id（`gpa-competitiveness-*`、`risk-preference-3`）已不存在。

- [ ] **Step 2: 重写三个案例的 answers**

- 删掉全部 `gpa-competitiveness-*` 的键；
- 案例一的 `gpa-competitiveness-freshman-3` 改为 `'accumulation-drive-4': <原值>`；
- `risk-preference-3` 改为 `'risk-preference-4': <原值>`；
- 三个案例各加 `'grad-intention-1': <选项>`：案例一用 `0`（想走保研，它的首选就是保研）；案例二、案例三分别期望首选 `cross-discipline-job` 与 `civil-service`，两条都是非升学路径，故用 `2`（不打算读研）；
- 顺手修掉越界值：`'risk-preference-2': 5` → `4`、`'public-affairs-leaning-2': 5` → `4`（选项只有下标 0–4，原来这两个值被当成未作答）。

- [ ] **Step 3: 跑，逐条核对首选路径**

Run: `pnpm --filter @navi/core test golden`
Expected: 三个案例的首选路径分别为 `same-discipline-baoyan`、`cross-discipline-job`、`civil-service`。

若某个 `expectTopPath` 变了：**先解释成因再改**。可行的成因是「删了绩点分项/加了意愿分项」，把该案例两条路径的 `match` 与贡献项打出来对比，确认新结果符合设计意图后才改期望值——不得整体重录。

- [ ] **Step 4: 跑全量**

Run: `pnpm test`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/fixtures/golden-cases.ts
git commit -m "test(core): 黄金案例集同步题目改动与意愿分项"
```

---

### Task 6: 前端丢弃陈旧答案

**Files:**
- Modify: `apps/web/src/components/Questionnaire.tsx`
- Test: `apps/web/src/components/Questionnaire.test.tsx`

**Interfaces:**
- Consumes: 无
- Produces: `onSubmit` 收到的 answers 只含当前题面里的题目 id

- [ ] **Step 1: 写失败测试**

在 `Questionnaire.test.tsx` 追加：预置 `localStorage` 里含一道已不存在题目的答案（如 `{ 'q1': 0, 'gone-1': 0 }`），传给组件的 `questions` 只有 `q1`，选完后提交，断言 `onSubmit` 收到的对象**不含** `gone-1`。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @navi/web test Questionnaire`
Expected: FAIL —— 提交对象里带着 `gone-1`。

- [ ] **Step 3: 实现**

提交处按当前题面过滤（`/api/diagnose` 对未知 id 是硬拒绝，删过题的客户端 localStorage 会带着旧 id）：

```tsx
const knownIds = new Set(questions.map(q => q.id))
const submitted = Object.fromEntries(
  Object.entries(answers).filter(([id]) => knownIds.has(id)),
)
onSubmit(submitted)
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @navi/web test`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/components/Questionnaire.tsx apps/web/src/components/Questionnaire.test.tsx
git commit -m "fix(web): 提交前丢弃不在当前题面的历史答案"
```

---

### Task 7: 设计文档同步

**Files:**
- Modify: `docs/superpowers/specs/2026-09-27-navi-career-planning-agent-design.md`

**Interfaces:**
- Consumes: Task 1–5 的实现
- Produces: 设计文档与实现一致

- [ ] **Step 1: 改算法与格式章节**

- §5.2：说明题目选项数默认 5 档位置映射，显式 `scores` 时按 `scores` 取值，选项可对某指标无信息。
- §5.3/§7.1：指标清单删 `gpa-competitiveness`、加 `保研意愿`/`考研意愿`/`不读研意愿`；写清三个意愿指标同源于一道题、互相排斥（选中一条即该条满分、另两条 0 分）；「每指标至少 3 道题」补一句例外：由多指标题供给的指标不受此约束。
- §6：题目 YAML 字段表补 `scores`（可选）、`indicator` 变为可选。
- §7.6/§7.2 的权重表：七条路径（4 条升学 + 3 条非升学）按 Task 4 的实际数值更新。
- §7.5：补一句资格条件的 `passWhen` 是选项**下标**，改选项顺序/数量必须同步。
- §7.3：注明单题指标的 `consistency` 恒为 0（样本不足），因此这两条路径的 `confidence` 会被拉低；`confidence` 不展示、不进上下文，仅入库。

- [ ] **Step 2: 改数据流与示例**

§4 数据流里引用 gpa 分项处，以及 §11.3 黄金案例集说明（题目与首选路径已变），一并对齐。

- [ ] **Step 3: 校验文档与实现一致**

Run: `grep -rn "绩点竞争力\|gpa-competitiveness" docs/superpowers/specs/2026-09-27-navi-career-planning-agent-design.md`
Expected: 只在描述历史/删除决策的句子里出现，权重表与指标表里没有。

- [ ] **Step 4: 提交**

```bash
git add docs/superpowers/specs/2026-09-27-navi-career-planning-agent-design.md
git commit -m "docs(spec): 同步升学意向指标与题目格式变更"
```

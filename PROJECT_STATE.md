# PROJECT_STATE

> 交接文档。记录继续开发所需的事实，不含讨论过程。
> 最后更新：2026-10-01 · 分支 `worktree-navi-core-pipeline` · HEAD `94084d3`

---

## 1. 项目目标

**Navi** —— 大学生生涯规划 Agent，面向大学新生及低年级学生。

学生填写结构化问卷 → 系统以**确定性算法**计算其生涯倾向 → 推荐适配的大学路径 → 输出该路径的完整真相（时间线、门槛、误区、代价）与日常任务侧重点。

**产品承诺是「抹平信息差」，因此信息准确性高于一切功能完整性。**

---

## 2. 权威文档

| 文档 | 作用 |
|---|---|
| `docs/superpowers/specs/2026-09-27-navi-career-planning-agent-design.md` | **唯一设计真相源**。设计变更只改这里 |
| `docs/superpowers/plans/2026-10-01-navi-core-pipeline.md` | 计划 ①（核心链路）的实施计划，16 个任务，已执行完毕 |
| `AGENTS.md` | 团队全部 AI 助手的共享上下文（模块边界、硬约束、文档索引） |
| `CLAUDE.md` | 一行 `@AGENTS.md`。不要在此写内容 |

---

## 3. 技术架构

```
TypeScript 全栈 · pnpm workspace · Hono · React + Vite + TailwindCSS · Vitest
大模型：DeepSeek（计划 ② 接入，当前代码零模型调用）
```

### 目录结构与依赖方向

```
packages/knowledge  ←  纯内容（Markdown/YAML）+ 构建期编译脚本
packages/core       ←  纯逻辑，零框架依赖，零网络请求
apps/api            ←  Hono 薄层，编排 core
apps/web            ←  React SPA，只消费 HTTP 接口
```

**依赖规则（由 ESLint 强制，见 `packages/core/eslint.config.js`）**：

- `packages/core` **不得** import `react` / `hono` / `express` / `fastify` / `vite` / `@navi/api` / `@navi/web`
- `packages/core` **不得**调用 `fetch` / `XMLHttpRequest`
- 该规则已验证会拦截违规导入，不是摆设

### 关键文件

| 路径 | 职责 |
|---|---|
| `packages/core/src/types.ts` | **输出契约**，三方共享的接口中心（设计文档 §7.8） |
| `packages/core/src/scoring.ts` | 指标计算、五档映射、作答一致性 |
| `packages/core/src/weights.ts` | 权重重归一化 |
| `packages/core/src/eligibility.ts` | 资格过滤（hard / soft） |
| `packages/core/src/matching.ts` | 理想值匹配度、置信度 |
| `packages/core/src/archetype.ts` | 余弦相似度、softmax 软归属 |
| `packages/core/src/diagnose.ts` | 编排入口 `diagnose()`、`findCloseMatches()` |
| `packages/knowledge/src/parse.ts` | frontmatter + `@block` 解析 |
| `packages/knowledge/src/validate.ts` | 校验（**仅警告不阻断**）与全部 schema 类型 |
| `packages/knowledge/src/build.ts` | 编译 Markdown → `dist/knowledge.json` |
| `apps/api/src/server.ts` | `createApp(bundle)`，三个端点 |
| `apps/web/src/App.tsx` | 年级选择 → 问卷 → 结果页 |

---

## 4. 当前代码状态

**分支**：`worktree-navi-core-pipeline`，17 个提交，**未合并到 main**
**工作区**：`F:\workspace\大学生生涯规划Agent\Navi\.claude\worktrees\navi-core-pipeline`

```bash
pnpm install
pnpm test        # 99 个测试，全绿
pnpm -r build    # tsc --noEmit + vite build，通过
pnpm -r lint     # 通过
```

### 测试分布

| 包 | 测试数 | 覆盖内容 |
|---|---|---|
| `packages/knowledge` | 11 | frontmatter / 块解析 / 校验规则 |
| `packages/core` | 59 | 六个算法模块 + 黄金案例集 |
| `apps/api` | 15 | 三个端点 + 年级分流 + 完整性校验 |
| `apps/web` | 14 | 问卷组件 + 结果页 |

### 端到端验证结果（已实测）

- 大一 / 大二各返回 25 道题，互不含对方的 gpa 题目版本
- 高学术志趣学生 → `same-discipline-baoyan` match 86.7 居首，画像 `steady-scholar` 0.722
- 学校无推免资格 → 两条保研路径 `applicable=false`、match=0，附失败原因，路径仍出现在结果中
- 答案不完整 → HTTP 400

### HTTP 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/api/questions?grade=` | 下发题目、指标、路径摘要（按年级过滤） |
| `POST` | `/api/diagnose` | 入参 `{ answers, grade }`，返回结构化结果 + `closeMatches` |
| `GET` | `/api/knowledge/:pathId` | 单条路径的完整内容块 |

---

## 5. 关键设计决策与约束

以下决策有连带约束，改动前必须先读设计文档对应章节。

### 5.1 推荐由确定性算法得出，大模型不参与决策

`diagnose()` 是纯函数：同样输入必然同样输出，不依赖网络与时钟。`/api/diagnose` 的响应不含任何模型生成内容。

**约束**：不得在 `core` 中引入模型调用；不得让前端或提示词绕过 `core` 实现推荐逻辑。

### 5.2 知识库：自由文档 + 稳定块级契约 + 优雅降级

`packages/knowledge/paths/<id>/index.md` 的 frontmatter 只含少量长期稳定字段（`id` / `title` / `category` / `span` / `status` / `updated` / `summary` / `weights` / `eligibility`），正文由 `<!-- @block type="..." -->` 注解分段。

**约束**：新增块类型**不需要改任何 schema**；前端遇到未识别块类型必须降级为富文本，**不得因此让构建失败**。

### 5.3 类型契约单一真相

`packages/core/src/types.ts` 是 `core` / `api` / `web` 三方共享的类型来源。前端通过 `import type` 引用（编译后完全擦除，零运行时依赖）。

**约束**：不得在前端手写镜像类型——那会让前后端静默漂移。

### 5.4 指标计算规则

- 五档评分映射固定为 `[0, 25, 50, 75, 100]`（`FIVE_POINT_SCALE`）
- 题目方向统一为「档位越高 = 指标越高」，**不引入反向计分**
- **每个指标至少 3 道题**（校验会警告）
- `weight <= 0` 的题目**不参与计分，也不参与一致性计算**（用于资格判断题）

### 5.5 置信度与不确定性

```
consistencyOf(scores) = max(0, 1 - stdev(scores) / 50)     // 总体标准差
confidence(path)      = Σ(W'[i] × consistency(i))           // W' 为归一化后权重
```

置信度来自**作答一致性**，不是「跳过题目的比例」。前端应把它画进匹配度条形图（实心段 = 已确认，斜纹段 = 浮动区间）。

### 5.6 匹配度用理想值模型

```
indicatorMatch(score, ideal) = max(0, 100 - |score - ideal|)
match(path)                  = Σ(match_i × W'[i])
```

**指标不是越高越好，而是看与理想值的接近程度。** 例如「学科认同」对跨学科路径的 `ideal` 是 30（认同度低反而匹配）。

### 5.7 「不适用」的路径保留并附原因

`hard` 约束失败时路径 `match` 记为 0、`applicable=false`，但**仍出现在结果中**并附 `failMessage`。隐藏路径会让用户困惑；解释本身就是信息。

### 5.8 年级分流

部分指标在低年级缺乏可观测数据（典型为 `gpa-competitiveness`）。处理方式：同一指标在不同年级由不同题目测量（`grades` 字段），API 按年级过滤后传给 `diagnose`。

**约束**：新增按年级分流的题目时，必须保证每个指标**跨所有年级的题目总数 ≥ 3**（校验按总数计算）。

### 5.9 全部题目必答

`/api/diagnose` 校验答案覆盖全部适用题目，缺失时返回 400 并列出缺失 id。部分作答会让 `known` 语义失真。

---

## 6. 已完成的功能

- [x] Monorepo 脚手架 + ESLint 模块边界约束
- [x] 知识库解析器（frontmatter + `@block`，未知块类型不报错）
- [x] 知识库编译与校验（`pnpm --filter @navi/knowledge build`）
- [x] 8 个指标定义、28 道题（含 1 道资格题）、7 条路径文档、6 个画像原型
- [x] `core` 全部六个算法模块 + `diagnose` 编排
- [x] 资格过滤、年级分流、答案完整性校验
- [x] Hono API 三个端点
- [x] 前端：年级选择 → 分组卡片问卷（localStorage 续填）→ 结果页
- [x] 黄金案例集（3 个典型学生）与确定性回归测试

---

## 7. 未完成任务

### 计划 ②：LLM 层（未开始）

设计文档 §8 已定义，实现内容：

- **个性化解读**：`diagnose` 输出 + 选中的路径知识全文 → 生成解读文本
- **追问**：上下文 = 学生画像摘要 + 当前路径全文 + 对话历史 + 所有路径的 200–300 字 `summary`
- **诚实边界**：`packages/knowledge/boundaries.md` 尚未创建（设计文档 §8.4），把「无法回答什么」变成内容资产
- **流式输出**：Vercel AI SDK（`ai` + `@ai-sdk/openai`，`baseURL` 指向 DeepSeek）
- **降级**：模型不可用时结构化结果完整可用，仅缺解读文字

### 计划 ③：可视化打磨（未开始）

设计文档 §9 定义了全部组件，当前前端只有纯文本排版：

- 路径匹配条形图（含置信度斜纹段）
- 8 维雷达图（未知维度显示缺口）
- **画像对比小窗口**（雷达图叠加 + 差距榜）
- **路径地图**（自绘 SVG + d3-hierarchy，节点颜色 = 学生匹配度）
- 时间线组件（`timeline` 块渲染 + 「你现在在这」标记）
- 误区卡 / 代价面板（`myth` / `cost` 块渲染）
- 结果页分享链接（URL 序列化画像状态）

---

## 8. 已知问题

### 8.1 内容债（影响演示效果，不影响功能）

- **全部 7 条路径的 `status` 均为 `draft`**，结果页每条都挂「待核实」角标。演示前建议把已确认内容改为 `verified`
- 路径的 `weights` 与 `ideal` 取值是初稿，需内容组复核
- `eligibility-tuimian-quota` 选「不清楚」或「没听说过」会**硬性剔除**两条保研路径。是否误伤实际有资格但不了解政策的低年级学生，属内容/产品判断

### 8.2 代码 Minor（5 条，已记录未修）

1. **`build.ts` 的 `readdirSync` 未排序** —— `bundle.paths` 顺序依赖文件系统，`diagnose` 的 `Array.sort` 是稳定排序，并列路径的先后在跨机器时可能不同，与「可复现」有张力。**一行 `.sort()` 可修**
2. 不适用路径的 `contributions` 未归零，分项之和与展示的 `match: 0` 不自洽（前端暂未消费）
3. `NormalizedWeights.coverage` 是未被消费的输出，语义上是「已知权重之和」而非比例
4. `packages/knowledge/src/index.ts` 未 re-export `build`
5. 前端缺少「信息不足」显式态（空答案已被 API 拒绝，但 UI 未提前拦截）；设计 §10 的「当前没有匹配的路径」汇总分支在真实内容下**不可达**（7 条路径中只有 2 条有 `eligibility`）

### 8.3 环境相关

- 本机 Node 25 暴露了一个**未初始化的全局 `localStorage`**，遮蔽 jsdom 实现。`apps/web/src/test-setup.ts` 已补内存实现，**不要删除那段代码**
- pnpm 11+ 用 `allowBuilds`（映射），不是 `onlyBuiltDependencies`（数组）。配置在 `pnpm-workspace.yaml`
- `apps/web` 的 vite 锁定 `^5.4.11`，因为 vitest 2.x 内部依赖 vite 5，升到 6 会导致 `Plugin` 类型冲突。**升级 vitest 3 时应同步升回**

### 8.4 待验证项（设计文档 §13）

- 跨路径追问的上下文组织方案（计划 ② 实现后验证）
- `consistencyOf` 的分母 `50` 取自标准差理论最大值，实际作答的标准差远低于此，**可能导致一致性普遍偏高、失去区分度**。需真实作答数据校准

---

## 9. 下一步开发计划

按依赖顺序：

1. **修 `readdirSync` 排序**（一行，与可复现性承诺直接相关）
2. **计划 ②（LLM 层）**——`diagnose` 输出的结构化 JSON 已可直接消费，边界清晰
3. **内容组并行**：把核心路径的 `status` 提到 `verified`，复核 `weights` / `ideal`，创建 `boundaries.md`
4. **计划 ③（可视化）**——依赖计划 ② 的接口定稿（解读文本的展示位置）

开发流程沿用既有约定：`AGENTS.md` 定义了模块边界与硬约束；提交信息用中文、遵循 Conventional Commits；涉及推荐逻辑的改动必须同步更新 `packages/core/src/fixtures/golden-cases.ts`。

---

## 10. 常用命令

```bash
pnpm install
pnpm test                                     # 先构建知识库，再跑全部测试
pnpm -r build                                 # 类型检查（web 含 vite build）
pnpm -r lint
pnpm --filter @navi/knowledge build           # 单独重建 dist/knowledge.json
pnpm --filter @navi/api dev                   # API :3000
pnpm --filter @navi/web dev                   # 前端 :5173（已配置 /api 代理到 3000）
```

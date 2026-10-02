# PROJECT_STATE

> 交接文档。记录继续开发所需的事实，不含讨论过程。
> 最后更新：2026-10-02 · 分支 `feat/llm-layer`（计划② 已完成，未合并）

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
大模型：DeepSeek，经 Vercel AI SDK v7（ai + @ai-sdk/openai）接入
```

### 目录结构与依赖方向

```
packages/knowledge  ←  纯内容（Markdown/YAML）+ 构建期编译脚本
packages/core       ←  纯逻辑，零框架依赖，零网络请求
packages/llm        ←  提示词与模型编排，只依赖 core 的类型
apps/api            ←  Hono 薄层，编排 core 与 llm
apps/web            ←  React SPA，只消费 HTTP 接口
```

**依赖规则（由 ESLint 强制，见 `packages/core/eslint.config.js`）**：

- `packages/core` **不得** import `react` / `hono` / `express` / `fastify` / `vite` / `ai` / `@ai-sdk/*` / `@navi/llm` / `@navi/api` / `@navi/web`
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
| `packages/knowledge/src/build.ts` | 编译 Markdown → `dist/knowledge.json`（含 `boundaries.md`） |
| `packages/llm/src/context.ts` | **纯函数**：按 §8.2 / §8.5 拼 `<knowledge>` 块 |
| `packages/llm/src/index.ts` | 读提示词、建 provider、`streamInterpret` / `streamChat` |
| `packages/llm/prompts/*.md` | 提示词，不硬编码进 TypeScript（§8.8） |
| `apps/api/src/server.ts` | `createApp(bundle, options?)`，五个端点 |
| `apps/web/src/components/PathAssistant.tsx` | 解读区 + 追问框，锚在选中的本路径上 |
| `apps/web/src/App.tsx` | 年级选择 → 问卷 → 结果页 |

---

## 4. 当前代码状态

**分支**：`feat/llm-layer`（计划② 的 7 个任务，**未合并到 main**）；`main` 停在 `210255f`
**工作区**：`F:\workspace\大学生生涯规划Agent\Navi`（**仓库根，唯一权威工作树**）

> ⚠️ `.claude/worktrees/navi-core-pipeline/` 是被 `.gitignore` 忽略的**残缺副本**：没有 `docs/`、`AGENTS.md`、`CLAUDE.md`、`eslint.config.js`，`apps/` 是空目录，在该目录下 `pnpm -r lint` 会失败。**不要在副本里开发**，可删除。

```bash
pnpm install
pnpm test        # 154 个测试，全绿
pnpm -r build    # tsc --noEmit + vite build，通过
pnpm -r lint     # 通过
```

### 测试分布

| 包 | 测试数 | 覆盖内容 |
|---|---|---|
| `packages/knowledge` | 21 | frontmatter / 块解析 / `:::` 容器解析 / 校验规则 / 编译顺序确定性 / 诚实边界 |
| `packages/core` | 61 | 六个算法模块 + 黄金案例集 |
| `packages/llm` | 17 | SDK 冒烟 / 上下文组装 / 模型编排 / 降级 |
| `apps/api` | 28 | 五个端点 + 年级分流 + 完整性校验 + LLM 降级 + 追问上限 |
| `apps/web` | 27 | 问卷 + 结果页 + 本路径选择 + 解读与追问（含真实 hook 的流协议接缝） |

### 端到端验证结果（已实测）

- 大一 / 大二各返回 25 道题，互不含对方的 gpa 题目版本
- 高学术志趣学生 → `same-discipline-baoyan` match 86.7 居首，画像 `steady-scholar` 0.722
- 学校无推免资格 → 两条保研路径 `applicable=false`、match=0，附失败原因，路径仍出现在结果中
- 答案不完整 → HTTP 400
- **无 API Key 时的降级（计划②验收标准）**：`/api/interpret` 与 `/api/chat` 返回 503 并附明确原因；`/api/diagnose` 仍返回完整的 8 指标 / 7 路径 / 6 画像

### HTTP 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/api/questions?grade=` | 下发题目、指标、路径摘要（按年级过滤） |
| `POST` | `/api/diagnose` | 入参 `{ answers, grade }`，返回结构化结果 + `closeMatches` |
| `POST` | `/api/interpret` | 入参 `{ answers, grade, pathId }`，返回**纯文本流**的个性化解读 |
| `POST` | `/api/chat` | 入参 `{ answers, grade, pathId, messages }`，返回 **UI 消息流**的追问回答 |
| `GET` | `/api/knowledge/:pathId` | 单条路径的完整内容块 |

两个 LLM 端点都用 `answers + grade` **服务端重算诊断**，不接受客户端传来的结果（§5.1 确定性）。

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

### 计划 ②：LLM 层（代码已完成，见 `docs/superpowers/plans/2026-10-02-navi-llm-layer.md`）

- [x] `packages/llm`：提示词落盘 + 上下文组装纯函数 + 模型编排（`streamInterpret` / `streamChat`）
- [x] `packages/knowledge/boundaries.md` 编译进 bundle（§8.4）
- [x] `POST /api/interpret`（纯文本流）与 `POST /api/chat`（UI 消息流）
- [x] 降级：未配置模型时 503，诊断结果不受影响
- [x] 前端：结果页路径可点选为本路径，解读区 + 追问框

**仍未做**（属于计划②范围但未完成）：

- **有 API Key 的真实模型验证**——本机无 Key，真实输出质量从未跑过（降级路径已实测通过）
- `boundaries.md` 只有从设计 §8.4 转写的 2 条，内容组未扩充

**Agent 上下文**（用户指定，已在 `packages/llm/src/context.ts` 落实）：各维度得分 + 最终测试结果 + 对话历史 + 本路径介绍全文 + 7 条路径的 summary + 诚实边界。

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

### 8.2 代码 Minor（已全部修复，未提交）

原记录 5 条已处理，另发现并修掉 1 条。每条都有对应的失败用例兜底（「关掉修复就会红」已实测）。

1. **`build.ts` 顺序不确定** —— `readdirSync` 结果已排序，且 `paths` 最终按 `id` 排序，产物顺序不再依赖文件系统枚举顺序。新增 `packages/knowledge/src/build.test.ts`
2. **不适用路径的 `contributions` 未归零** —— 现在归零为空数组，分项之和与 `match: 0` 自洽
3. **`NormalizedWeights.coverage`** —— 无生产代码消费，且语义是「已知权重之和」而非比例，**已删除该字段**
4. **`packages/knowledge/src/index.ts` 未 re-export `build`** —— 已补
5. **前端缺两个显式态** —— `App.tsx` 在无题可答时给出「信息不足」而非让用户提交后撞 API 400；`ResultView.tsx` 在**全部**路径 hard 不适用时输出「当前没有匹配的路径」汇总（设计文档 §10），并抑制此时无意义的「分数很接近」提示
6. **（新发现）`buildKnowledge(rootDir)` 的 `rootDir` 此前只对 `paths/` 生效** —— `readYamlDir` 硬编码了模块级 `ROOT`，已改为尊重入参

**遗留观察（未处理，需设计判断）**：`findCloseMatches` 在「全部路径都不适用」时会回退到全体路径比较（计划 Task 12 的既定行为）。此时所有 `match` 都是 0，`closeMatches` 会返回全部 7 条 id。UI 已在渲染层抑制该提示，但接口层面仍会下发这个无意义的数组。是否改掉回退逻辑，属设计判断，动之前先确认。

### 8.3 环境相关

- 本机 Node 25 暴露了一个**未初始化的全局 `localStorage`**，遮蔽 jsdom 实现。`apps/web/src/test-setup.ts` 已补内存实现，**不要删除那段代码**
- pnpm 11+ 用 `allowBuilds`（映射），不是 `onlyBuiltDependencies`（数组）。配置在 `pnpm-workspace.yaml`
- `apps/web` 的 vite 锁定 `^5.4.11`，因为 vitest 2.x 内部依赖 vite 5，升到 6 会导致 `Plugin` 类型冲突。**升级 vitest 3 时应同步升回**

### 8.4 待验证项（设计文档 §13）

- 跨路径追问的上下文组织方案（§13.1）——**已实现，尚未实测**：`buildSystemContent` 按 §8.5 拼装了画像 + 诊断 + 本路径全文 + 全部 summary + 边界，但「2K 字摘要是否够用」「模型是否忽略摘要细节」需要真实模型回答质量来判定
- `consistencyOf` 的分母 `50` 取自标准差理论最大值，实际作答的标准差远低于此，**可能导致一致性普遍偏高、失去区分度**。需真实作答数据校准

### 8.5 Vercel AI SDK v7 与网上示例（多为 v5）的断裂点

这几处已在代码里处理，但下次动 SDK 时容易踩：

- `messages` 里**不能**出现 `system` 角色，否则抛 `AI_InvalidPromptError`；系统提示要走 `instructions` 选项
- `useChat` **不接受** `api` 选项，改为 `useChat({ transport: new DefaultChatTransport({ api, body }) })`
- `useCompletion` 的 `streamProtocol` **默认为 `"data"`**（UI message 事件流），而 `/api/interpret` 用 `toTextStreamResponse()` 返回纯文本。不显式传 `streamProtocol: 'text'` 时，纯文本被当作事件流解析：解析不出分片、不抛错、`completion` 恒为空串，症状是「生成结束后解读区变空白」。**响应格式与 `streamProtocol` 必须成对**：`toTextStreamResponse()` ↔ `'text'`，`toUIMessageStreamResponse()` ↔ `'data'`
- `ai/test` 导出的是 `MockLanguageModelV3` / `MockLanguageModelV4`（**没有 V2**）；mock 的 `finish` 分片里 `finishReason` 是 `{ unified, raw }`、`usage` 是嵌套对象，不是裸值

`packages/llm/src/sdk-smoke.test.ts` 是这一切的基准，改 SDK 版本后先跑它。

### 8.6 已知缺陷：`/api/interpret` 的流中途失败不会降级

**现象**（已实测，非推测）：模型在**首 token 之后**失败（超时、欠费、上行被掐断）时——

| 端点 | 客户端看到什么 |
|---|---|
| `/api/chat`（UI 消息流） | 错误进流，`useChat` 置 `error` → 显示「追问暂时不可用」✓ |
| `/api/interpret`（**纯文本流**） | **HTTP 200 正常结束，拿到半截解读文本，没有任何错误信号** ✗ |

服务端只把错误打进了 stderr；`streamText` 的 `.text` 此时 resolve 出已累积的部分文本，**不抛错**；纯文本流也不带错误通道，所以客户端无从判断。

**后果**：§8.7 对解读端点不成立。用户会看到一句半截的解读，并以为它是完整的——对一个以「信息准确性」为承诺的产品，这比整页报错更糟。发生在首 token 之前的失败（坏 Key、欠费、连不上）不受影响，那些在流打开前就被识别为 503。

**证据**：`packages/llm/src/index.test.ts` 里名为「【已知缺陷】流中途出错时 text 静默返回已累积的部分文本」的用例把当前行为钉住了。

> **决定：保持现状，不修**（2026-10-02，项目所有者）。理由是不为此改动已批准的端点契约。修复方向留档见下，将来若要动手，先改设计文档再改代码。

**修复方向**（需先改设计文档 D3 的端点契约，故未在计划②内动手）：把 `/api/interpret` 从 `toTextStreamResponse()` 换成 `toUIMessageStreamResponse()`，前端相应改用 `useChat` 消费。UI 消息流自带错误通道，届时上面那条用例会主动变红，提醒一并更新。另一种更小但不完整的做法是在开流前先等到首 token、失败即返回 503——它挡不住首 token 之后的失败。

---

## 9. 下一步开发计划

按依赖顺序：

1. ~~修 `readdirSync` 排序~~（已完成，见 §8.2）
2. ~~计划 ②（LLM 层）~~（代码已完成，见 §7）
3. **配好 `DEEPSEEK_API_KEY` 跑一次真实模型**——这是计划②唯一未经检验的部分
4. **内容组并行**：把核心路径的 `status` 提到 `verified`，复核 `weights` / `ideal`，扩充 `boundaries.md`
5. **计划 ③（可视化）**——依赖计划 ② 的接口定稿（解读文本的展示位置）

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

**启用真实模型**：把 `.env.example` 复制为 `.env`，填 `DEEPSEEK_API_KEY`（`DEEPSEEK_BASE_URL` 与 `DEEPSEEK_MODEL` 可选，默认指向 `https://api.deepseek.com/v1` 的 `deepseek-chat`）。`.env` 只在 `apps/api/src/index.ts` 读，已被 `.gitignore` 忽略。**不填也能跑**——解读与追开会降级为「暂不可用」，其余结果完整。

**两个调试陷阱（都表现为「配好 Key 仍显示暂不可用」）：**

1. `.env` 只在 API 进程启动时读一次，没有 watcher 盯着它。改完 `.env` 必须重启 API。
2. 陈旧的 dev 进程会占住 `:3000`。此时新的 `pnpm dev` 起不来却不显眼（vite 自动退到 5174，浏览器仍连着旧的 5173），页面继续由那个**启动早于 `.env` 写入**的旧 API 应答——症状与完全没配 Key 一模一样。先确认端口归属，再排查别的：

```bash
netstat -ano | grep LISTENING | grep -E ":(3000|5173) "   # 记下 PID
powershell.exe -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Select-Object ProcessId,CreationDate,CommandLine | Format-List"
```

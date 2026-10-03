# AGENTS.md

本文件是**团队全部 AI 编程助手共享的项目上下文**，适用于 Claude Code、Cursor、
GitHub Copilot、Codex、Gemini CLI 等所有支持 `AGENTS.md` 约定的工具。

> **修改本文件需要团队确认**——它会同时改变所有成员 AI 助手的行为。
> Claude Code 用户通过根目录的 `CLAUDE.md`（仅一行 `@AGENTS.md`）读取本文件。

---

## 项目是什么

**Navi** —— 大学生生涯规划 Agent。

学生填写结构化问卷 → 系统以确定性算法计算其生涯倾向 → 推荐适配的大学路径 →
输出该路径的完整真相（时间线、门槛、误区、代价）与日常任务侧重点。

目标用户：大学新生及低年级学生。

**产品承诺是「抹平信息差」，因此信息准确性高于一切功能完整性。**

---

## 必读：设计文档

```
docs/superpowers/specs/2026-09-27-navi-career-planning-agent-design.md
```

**开始任何开发任务前，先阅读该文档中与你任务相关的章节。**
该文档是唯一的设计真相源。本文件只是索引与硬约束，**不复制其内容**——
设计变更只改设计文档，不要在本文件中重述设计。

账号、会话、测评记录留存，以及上下文与用户的绑定，另有专项设计：
`docs/superpowers/specs/2026-10-02-navi-account-storage-design.md`
（主文档 §3.4、§4.2、§8.2 指向它）。**动这几块时两份都要读。**

### 章节索引

| 你要做什么 | 读哪节 |
|---|---|
| 理解整体链路 | §4 数据流 |
| 编写 / 修改知识库内容 | §6 知识库设计 |
| 实现任何算法 | §7 核心算法层 |
| 对接前后端数据结构 | §7.8 输出契约 |
| 编写提示词 | §8 LLM 层 |
| 开发界面与图表 | §9 前端与可视化 |
| 处理异常与降级 | §10 边界情况 |
| 组织测试 | §11 测试策略 |
| 排开发顺序 | §12 实施顺序 |

---

## 技术栈

TypeScript 全栈 · pnpm workspace · Hono · React + Vite + TailwindCSS ·
Recharts · Vercel AI SDK · DeepSeek

---

## 模块边界（严格遵守）

```
packages/knowledge  ←  纯内容，Markdown / YAML，不含逻辑
packages/core       ←  纯逻辑，零框架依赖，零网络请求
packages/llm        ←  依赖 core 的类型
apps/api            ←  编排层，调用 core 与 llm
apps/web            ←  只消费 HTTP 接口
```

**禁止事项：**

- `packages/core` 不得引入任何框架依赖，不得发起网络请求，不得依赖 `llm` / `api` / `web`
- 不得将知识库内容硬编码进 TypeScript 源码
- 前端代码中不得出现任何 API Key
- 不得绕过 `core` 直接在前端或提示词中实现推荐逻辑

---

## 硬性约束

1. **推荐结果必须由 `core` 的确定性算法得出，不得由大模型生成。**
   大模型只负责解读与追问，不参与任何决策。同一学生重复测评必须得到相同的推荐结果。

2. **知识库内容不得编造。** 未经核实的内容标注 `status: draft`，前端会显示「待核实」角标。
   凭印象写入错误信息，比不写更糟——它直接违背产品承诺。

3. **知识库出现新块类型时不得导致构建失败。** 前端对未识别块类型降级为富文本渲染。

4. **`.env` 必须保持在 `.gitignore` 中。** API Key 泄露是安全事故，不是小疏忽。

5. **涉及推荐逻辑的改动，必须同步更新黄金案例集**（设计文档 §11.3）。

---

## 开发命令

```bash
pnpm install      # 安装依赖
pnpm dev          # 并行启动 api（:3000）与 web（:5173），前端由 vite 代理 /api
pnpm test         # 先编译知识库，再跑全部包的测试
pnpm lint         # 全部包 lint
pnpm build        # 全部包构建 / 类型检查
```

单包：`pnpm --filter @navi/<包名> test|build|lint`（包名 `knowledge` / `core` / `llm` / `api` / `web`）。

**首次运行前**：复制 `.env.example` 为 `.env`，填 `DEEPSEEK_API_KEY` 与 `JWT_SECRET`。
`.env` 只在服务端读（硬性约束 4）。两项留空的后果是**降级而非崩溃**：缺 API Key →
解读与追问返回 503，结构化结果完整可用；缺 JWT_SECRET → 账号与受保护端点一律 503。

**两条与「改了东西但没生效」有关的坑**，排查时先看这两处：

1. **改知识库内容要重新构建。** 题目、选项、权重改完必须
   `pnpm --filter @navi/knowledge build` 才会生成 `packages/knowledge/dist/knowledge.json`；
   api 读的是这份产物。dev 下产物一变 api 会自动重启（dev 脚本带 `--include`），
   但 yaml 本身不在 watch 范围内。`pnpm test` 会自动先构建一次。
2. **端口被陈旧 dev 进程占着时，重启会静默失效。** 抢不到端口的新进程立刻以
   `EADDRINUSE` 崩掉，而它的 `tsx watch` 监督进程还活着——看起来重启过了，实际一直是
   旧进程在服务（症状：改过 `.env` 后显示「暂不可用」，改过题面后页面还是旧题目）。
   先查占用者的启动时间，不要先怀疑 `.env` 或浏览器缓存：
   `netstat -ano | grep LISTENING | grep -E ":(3000|5173)"`，必要时清掉全部 `tsx watch` 进程再起。

---

## 给 AI 助手的指令

- **先读设计文档，再动手。** 不要基于常识推测本项目的设计意图。
- **不确定就问，不要假设。** 尤其是涉及算法公式、知识库格式、模块边界时。
- 修改 `packages/core` 前读设计文档 §7；修改知识库格式前读 §6。
- 设计文档中标注为「**待验证项**」或「**后续迭代**」的内容，**不要在 MVP 阶段实现**。
- 若发现设计文档与实际代码不一致，**指出矛盾，不要擅自选择一方**。
- 提交信息使用中文，遵循 Conventional Commits（`feat:` / `fix:` / `docs:` / `chore:` 等）。
- **提交前 `pnpm test` 与 `pnpm lint` 都要绿。** 改到题目、选项、路径权重时，还要确认
  知识库编译 0 告警、黄金案例集已同步（硬性约束 5）。

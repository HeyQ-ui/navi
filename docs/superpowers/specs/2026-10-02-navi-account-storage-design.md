# Navi 账号与存储 · 专项设计

> 本文件是「账号与存储」专项的设计真相源。它**扩展**主文档
> `2026-09-27-navi-career-planning-agent-design.md`（下称主文档），不重复其内容。
> 与主文档冲突处以本文件为准，并回头修正主文档（见 §9）。
>
> 主文档 §4.2 已定下测评记录留存的四条约束，同时明确把「账号模型、存储介质、
> 追加语义、会话与上下文的绑定」划归独立专项。本文件补齐这一块。

| 项目 | 内容 |
|---|---|
| 文档版本 | v1.2 |
| 日期 | 2026-10-02（v1.2 修订于 2026-10-03） |
| 状态 | v1.2 待评审 |

**v1.2 修订摘要**（2026-10-03）：

- 新增 §11「账号级对话与用户绑定上下文」：上下文绑定到用户（纳入最近 4 次自我测评
  摘要）、对话流改为账号级连续且以服务端为真相源、解读新增「你的变化」段
- §7 的不变量改写：从「上下文只由单一记录构造」改为**归属 + 来源**两条可检查的规则
  ——多记录上下文不违规，混用才违规
- §1.1 交付补 3 项（对话流、上下文绑定、四段解读）；§1.2 移出两条（追问持久化、
  把测评历史喂进上下文）
- §3 数据模型增加 `messages` 表

---

## 1. 范围

### 1.1 交付

| # | 交付物 | 对应主文档 |
|---|---|---|
| 1 | 用户注册与登录（用户名 + 密码） | 本文件新立 |
| 2 | 会话（httpOnly cookie 中的 JWT） | 本文件新立 |
| 3 | 测评记录落库，满足四条留存约束 | §4.2 |
| 4 | **个性化解读随测评记录持久化**（§4.7） | 本文件新立，是对 §4.2 的扩展 |
| 5 | 只读历史列表界面 | 本文件新立 |
| 6 | 「测测自己 / 测测别人」入口 | §9.1（已写明，尚未实现） |
| 7 | **账号级连续对话流**：整个账号一条，服务端为真相源（§11） | 本文件新立 |
| 8 | **agent 上下文绑定到用户**：纳入最近 4 次自我测评摘要（§11.4） | 实现 §4.2 第 4 条预留的扩展 |
| 9 | 解读新增「你的变化」段（§11.5） | §8.2（输出结构三段改四段） |

### 1.2 明确不做

- 密码找回、邮箱验证、第三方登录
- 登出全部设备、会话主动吊销
- 历史记录的删除 / 编辑
- 解读的「重新生成」按钮（存了就不重算；为空时自动补生成一次，见 §4.7）
- 对话流的清空 / 单条删除（账号级流只增不减；要清空时另行立项）
- 跨账号的对话或上下文共享

---

## 2. 技术选型：零新依赖

| 需要 | 用什么 | 依据 |
|---|---|---|
| 存储 | `node:sqlite` 的 `DatabaseSync` | Node 25 内置（本机实测 v25.9.0，`DatabaseSync`/`StatementSync` 可用） |
| 密码哈希 | `node:crypto` 的 `scryptSync` + 每用户随机盐 + `timingSafeEqual` | stdlib |
| 会话签发 / 校验 | `hono/middleware/jwt` | Hono 4.13.12 自带，已在依赖里 |
| cookie 读写 | `hono/helper/cookie` | 同上 |
| 主键 / 盐 | `crypto.randomUUID()` / `crypto.randomBytes()` | stdlib |

### 2.1 为什么不新建 package

存储与账密校验都是 **I/O**，不能进 `packages/core`（零框架依赖、零网络）；也不属于
`packages/llm`（只依赖 core 类型）。按 AGENTS.md 的模块边界，它们的归属是
`apps/api`——编排层。

不建 `packages/store` 的理由是 YAGNI：现在只有 `apps/api` 一个消费者。将来 §13.2 的
参数校准要读数据，直接对 `navi.db` 跑 SQL 比 import 一个 TS 包更顺手。等真出现第二个
TS 消费者再抽包，那时才知道该抽什么形状。

### 2.2 文件落位

```
apps/api/src/auth.ts    注册 / 登录 / 登出 / me + 会话中间件
apps/api/src/store.ts   sqlite 打开、建表、用户读写、测评记录追加与查询
apps/api/src/server.ts  挂路由；给三个测评端点加会话要求
apps/api/data/navi.db   数据文件（目录由 store 在启动时创建）
```

`auth.ts` 与 `store.ts` 都留在 `apps/api` 内，按职责分文件而非按层分包。

---

## 3. 数据模型

三张表：`users`、`assessments`、`messages`。前两张覆盖 §4.2 表格的四行，外加持久化
解读所需的列（对应关系见 §3.1）；`messages` 承载账号级对话流，定义见 §11.2。

```sql
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,      -- crypto.randomUUID()
  username      TEXT NOT NULL UNIQUE,  -- trim + 小写归一化后的值，见 §3.2
  password_hash TEXT NOT NULL,         -- scrypt 输出，hex
  salt          TEXT NOT NULL,         -- 16 字节随机盐，hex
  created_at    TEXT NOT NULL          -- ISO 8601
);

CREATE TABLE IF NOT EXISTS assessments (
  id             TEXT PRIMARY KEY,     -- crypto.randomUUID()
  user_id        TEXT NOT NULL REFERENCES users(id),
  source         TEXT NOT NULL CHECK (source IN ('self','other')),  -- §4.2 第 1、4 条
  grade          TEXT,                 -- 测评时选的年级
  answers        TEXT NOT NULL,        -- JSON: QuestionId -> 0..4   §4.2「完整作答」
  result         TEXT NOT NULL,        -- JSON: 完整 DiagnosisResult  §4.2 其余三行
  interpretation TEXT,                 -- 个性化解读全文，生成成功后补写一次；未生成为 NULL（§4.7）
  created_at     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_assessments_user
  ON assessments(user_id, created_at DESC);
```

### 3.1 字段与 §4.2 表格的对应

| §4.2 要求 | 落在哪 |
|---|---|
| 完整作答（逐题，不存摘要） | `answers` |
| 匹配度与推荐结果（完整 `DiagnosisResult`） | `result` |
| 作答一致性（每指标一份） | `result.indicators[*].consistency` |
| 置信度（每条路径一份） | `result.paths[*].confidence` |
| **个性化解读**（本文件扩展，§4.2 原文未列） | `interpretation` |

解读挂在**该条记录的主推荐路径**上，与结果页的口径一致（§9.3）。主推荐路径可由
`result` 快照用 `findTiedPaths` 推出，所以不另存 `interpretation_path_id`——快照是
不可变的，推导结果不会变。

### 3.2 四处刻意的取舍

**`result` 存快照，不只存 `answers` 重算。** core 是确定性的，`answers` 足够重算——
但快照保证「用户当时看到的」不随算法或知识库改动而变，且 §4.2 明写要留存匹配度与
推荐结果。存两份，`answers` 是事实、`result` 是快照。

**不给一致性 / 置信度单独建列。** 为 §13.2 校准查分布时用
`json_extract(result, '$.indicators.<id>.consistency')` 即可。现在为了查询方便去
范式化，是本末倒置。

**用户名只存归一化后的值，不额外存原始大小写。** `username` 列里放的就是
`trim().toLowerCase()` 之后的字符串，显示时也用它——输入 `Alice` 会显示成 `alice`。
这样 `Alice` 与 `alice` 天然是同一人（§6），无需第二个 `username_key` 列去做唯一性，
也不会出现「唯一键与显示名不一致」这类只有排查时才发现的错位。代价是丢了用户输入的
原始大小写。若将来要还原显示形式，再加一列 `display_name`，不影响已有数据。

**解读用可空列，不建独立表。** 解读在记录创建时还不存在（它是结果页挂载后才生成的），
所以只能是「先建行、后补字段」。独立表能换来的好处是「同一条记录可存多份解读」——
而存了就重算是不做的（§1.2），这个好处落不到地。代价见 §4.4：记录行因此不是绝对
只写一次的。

### 3.3 数据文件的位置与保护

数据库路径按 **模块 URL** 解析，不按 `process.cwd()`：

```ts
new URL('../data/navi.db', import.meta.url)   // → apps/api/data/navi.db
```

理由与 `index.ts` 里 `.env` 的注释同源——`pnpm --filter @navi/api dev` 的 cwd 是
`apps/api`，按 cwd 解析在别的启动方式下会漂移。

`.gitignore` 必须新增 `apps/api/data/`。**库里存着用户名与密码哈希，提交它是安全
事故**，与硬性约束第 4 条（`.env` 不进 git）同级。

---

## 4. 接口面

### 4.1 新增端点

| 方法 | 路径 | 请求 | 响应 |
|---|---|---|---|
| `POST` | `/api/auth/register` | `{username, password}` | `201 {id, username}` + Set-Cookie |
| `POST` | `/api/auth/login` | `{username, password}` | `200 {id, username}` + Set-Cookie |
| `POST` | `/api/auth/logout` | — | `204`，清 cookie |
| `GET` | `/api/auth/me` | — | `200 {id, username}` / `401` |
| `GET` | `/api/assessments` | — | `200 {assessments: [...]}` 倒序 / `401` |
| `GET` | `/api/assessments/:id` | — | `200 {id, source, grade, createdAt, answers, result, interpretation, mainPathId, tiedPaths, paths}` / `401` / `404` |

失败码：

- `400` 用户名或密码不合规（长度越界）
- `401` 登录失败；未登录访问受保护端点
- `404` 记录不存在**或不属于本人**——两种情况合并成 404，不泄露他人记录的存在性
- `409` 注册时用户名已被占用
- `503` 未配置 `JWT_SECRET`（见 §4.5）

`GET /api/assessments` 的每条列表项：

```ts
{ id, source, grade, createdAt, mainPathId, match }
```

`mainPathId` / `match` 从该条 `result` 上用 core 的 `findTiedPaths` 得出，与结果页
口径一致（主文档 §9.3），不另立算法。列表不渲染并列提示，所以列表项不带 `tiedPaths`
——那是详情响应的事。

`GET /api/assessments/:id` 自带宽渲染结果页所需的 `paths` 摘要（与 `/api/questions`
下发的同形），使历史详情成为**一次**请求，不依赖第二次往返。它同时返回
`interpretation`（可为 `null`，见 §4.7）与 `mainPathId`。

### 4.2 现有三个端点的改动

解读要写回「哪一条记录」，所以这三个端点的入参从「客户端提交答案」改为
「指向一条已落库的记录」。

| 端点 | 现在 | 改为 |
|---|---|---|
| `POST /api/diagnose` | 入 `{answers, grade}`；返回诊断结果 | 入参不变，**返回体多一个 `assessmentId`** |
| `POST /api/interpret` | 入 `{answers, grade, pathId}` | 入 **`{assessmentId, pathId}`** |
| `POST /api/chat` | 入 `{answers, grade, pathId, messages}` | 入 **`{assessmentId, pathId, question}`** —— 只发本轮新问题，历史由服务端从库里取（**§11.3 再次改动了这一行，以 §11.3 为准**） |

**为什么不再传 `answers`：** 有了 `assessmentId`，服务端就能从**自己的库**里读出
该记录的 `answers` 与 `result`。这比让客户端每次重申答案更可信——记录是服务端写的，
客户端改不了它，而请求体谁都能改。于是 `validateAnswers` 从这两个端点上摘掉，
换成「按 id 取记录 → 校验归属 → 用记录里的数据」。`/api/diagnose` 保留
`validateAnswers`，它仍是客户端首次提交答案的入口。

`pathId` 仍需校验：它必须是该记录 `result` 里真实存在的路径。

`assessmentId` 不存在或不属于当前用户 → `404`（与 `GET /api/assessments/:id` 同口径，
不泄露他人记录的存在性）。

### 4.3 受限与公开的界线

| 端点 | 会话 |
|---|---|
| `POST /api/diagnose` | 必需 |
| `POST /api/interpret` | 必需 |
| `POST /api/chat` | 必需 |
| `GET /api/auth/me`、`/api/assessments*` | 必需 |
| `GET /api/questions`、`GET /api/knowledge*` | **保持公开** |

公开的知识库与问卷不损害任何东西：取题与浏览知识本身无副作用。门只开在会产生
**记录**或**模型调用**的端点上，这是满足「每条记录都有主人」的最小门槛。

副产品：主文档 §9.1 的「知识库可独立访问」不受登录门槛影响——浏览知识不需要登录。
分享链接也不受影响：分享的是 URL 快照，观看者无需登录即可看结果；但只要他点「解读」
或「追问」，就会被要求登录。这是登录门槛的必然结果，已确认接受。

### 4.4 落库时机

落库在 `POST /api/diagnose` **服务端内部**：一次请求，服务端手里已经有 `answers`
和刚算出的 `result`，追加一行即可。不让客户端另发一次保存请求——那样既要多一次往返，
又要把「存什么」交给不可信的客户端。

追加语义（§4.2 第 2 条）由此成立：同一用户重复提交同一份答案会得到两条独立记录，
这正是「历史不丢」要的行为。

**§4.2 第 2 条说的「不覆盖」指的是测评记录不互相覆盖，不是「行永远不被写第二次」。**
记录行落库时 `interpretation` 为 `NULL`，在解读生成成功后被补写一次（§4.7）。这是
该行**唯一**一次更新，且只写这一个字段；`answers`、`result`、`source`、`created_at`
一经写入永不改变。这个区分要写进代码注释——否则后来者会把「补写解读」当成违规。

### 4.5 `JWT_SECRET` 缺失时 fail closed

沿用本仓库已有的降级写法（`/api/interpret`、`/api/chat` 在未配置模型时返回 503），
认证端点在未配置 `JWT_SECRET` 时返回 `503 {error: '账号功能暂不可用：服务端未配置会话密钥'}`，
而不是抛异常。

**必须用 falsy 判断，不能用 `??`：** `.env.example` 里 `JWT_SECRET=` 是留空的，
`loadEnvFile` 会把它设成空串，`??` 只挡 `null`/`undefined`，空串会穿过去——那就是
一个可预测的空签名密钥。这个坑本仓库已经踩过一次（`DEEPSEEK_BASE_URL` 的注释记着）。

`.env.example` 新增一行：

```
# 会话签名密钥。留空则账号功能不可用（503）。生成：openssl rand -hex 32
JWT_SECRET=
```

### 4.6 cookie 与会话

- 名字 `navi_session`，JWT payload `{ sub: userId, username }`，有效期 7 天
- `HttpOnly`（前端 JS 读不到，杜绝 XSS 窃取）、`SameSite=Lax`、`Path=/`
- `Secure` 仅在非本地环境加（dev 是 http）
- 登出即 `Max-Age=0` 覆盖同名 cookie

`SameSite=Lax` + vite proxy 就够：前端用相对路径 `/api/...`，vite 已代理到 `:3000`，
浏览器看到的是**同源**，cookie 自动带上——不需要 CORS，也不需要改 `credentials`。
生产同源部署同理。

### 4.7 解读的生成与保存

**生成时机不变**：`PathAssistant` 挂载时自动调一次 `/api/interpret`
（`apps/web/src/components/PathAssistant.tsx` 现有行为），用户不需要点任何按钮。
所以「每个测试做完之后」≈「结果页出现时」，保存挂在这次生成上，不增加模型调用次数。

**只保存完整的。** 半截流出错时写入会留下一段残缺的解读，而它会被当成「已生成」而
再也不重算——这是最坏的组合。所以只在流**正常结束**后写：

- 由 `apps/api` 持有流结果对象，在流结束时拿到全文再写库
- 不把存储带进 `packages/llm`——`streamInterpret` / `streamChat` 保持不认识存储。
  由路由层用流结果自带的了结回调（`onFinish`）或全文 promise 来落库
- 写入失败只记日志、不影响已经发给用户的响应（响应已开始流出）

> **实现前先证实一件事**：`toTextStreamResponse()` 被消费后，流结果对象上的全文
> promise 是否照常 resolve。AI SDK 版本差异可能让「消费响应体」与「拿全文」互斥；
> 若互斥，改用 `onFinish` 回调把全文交出来。这是本设计里唯一一处需要实测确认的机制。

**读取**：`GET /api/assessments/:id` 返回 `interpretation`。

- 非 `null` → 历史详情直接渲染这段文字，**不调 `/api/interpret`**，不重算
- `null`（模型当时不可用、或用户没等生成完就离开）→ 照常生成一次并补写，行为与
  首次一致

**agent 上下文用落库的 `result` 快照，不重算。** 配套改动：`packages/llm` 的
`streamInterpret` / `streamChat` 接受一个可选的预置 `result`，`sliceOf` 用它替代
内部的 `diagnose(answers, bundle)`。

理由是防止**显示与解释不一致**：主文档 §12.2 明说内容工作与开发完全并行，知识库会
在测评记录存在期间被重建。服务端的 `bundle` 在进程启动时读一次、整个生命周期不变
（`apps/api/src/index.ts`），所以跨进程重启后重算会产生与页面显示不同的 `result`——
页面写着匹配度 55，模型解释的是 62。这属于本项目最不能接受的一类错误：对用户陈述
自己结果时的失真。

注意这**没有**违反「推荐结果由确定性算法得出」这条原则（主文档 §1.3 第一款
「确定性优先」，以及 §4.1 决策一）：快照来自本服务端自己的库，不是请求体，推荐结果
仍然只由 core 算出。该注释要相应改述为「结果只能来自服务端自己——重算，或读本服务端
落库的快照」。

> **顺带指出一处现存错误**：`packages/llm/src/index.ts` 的 `sliceOf` 注释写着
> 「服务端自己重算诊断，不接受客户端传来的结果（**§5.1** 确定性）」，但主文档 §5.1
> 是「出题原则」，与确定性无关。该原则的所在是 §1.3 与 §4.1。改述注释时一并把引用
> 改正。

不可回避的残余不一致：解读引用的路径正文（`formatCurrentPath`）始终来自当前
`bundle`，无法随记录快照。这是内容与结果的分野，接受。

---

## 5. 前端

### 5.1 流程

```
未登录 ──▶ Login（注册 / 登录二合一）
             │
已登录 ──▶ 选择测评对象（测测自己 / 测测别人）
             │
         选择年级 ──▶ 问卷 ──▶ 结果页 ──▶ 追问
                                  │
             「我的历史」（只读列表）──▶ 点进去复用 ResultView
```

`App.tsx` 现有 `grade | loading | questions | result | error` 五个 stage，新增
`auth`（未登录）、`choosing`（选对象）、`history`（历史列表）。挂载时先 `GET
/api/auth/me`：200 进 `choosing`，401 进 `auth`。

「测测别人」与「测测自己」走**完全相同**的题目与算法，唯一差别是落库时的 `source`
与相应的用途（§4.2 第 1、4 条）。UI 上只是在进问卷前多选一次。

新增组件：`Login.tsx`（注册/登录切换）、`History.tsx`（只读列表）。历史详情复用现有
`ResultView`，组件本身不需要改——喂给它的是库里存的 `result` 快照。

### 5.2 历史详情：解读取存储值，追问仍实时

点进历史记录后：

- **解读**直接渲染 `GET /api/assessments/:id` 带回来的 `interpretation`，**不重算**。
  为空时才生成一次并补写（§4.7）。
- **追问**是实时问答，没有「历史追问记录」这回事（§1.2）。它锚在该记录的主推荐
  路径上，上下文由该记录的 `answers` 与 `result` 快照构造。

这不违反 §4.2 第 4 条——那条防的是**混用**（拿别人的画像解释你），而这里是用户
主动打开的一条规定记录，上下文只由它自己的数据构造。不变量的准确措辞见 §7。

### 5.3 组件改动

`ResultView` 不用改：喂给它的是库里存的 `result` 快照与 `paths` 摘要。需要改的是
`PathAssistant`——它的入参从 `{answers, grade, pathId}` 变为
`{assessmentId, pathId, interpretation?: string | null}`：

- `interpretation` 非 `null` → 渲染它，**不触发**生成
- `interpretation` 为 `null` → 走现有自动生成路径
- `useChat` 的 transport body 改为 `{assessmentId, pathId}`

**实现细节**：hook 不能条件调用，所以 `useCompletion` 照常调用，变的只是那个
`useEffect` 在 `interpretation` 非 `null` 时不触发；渲染取值用
`interpretation ?? completion`。这点要写进代码注释——写成条件调用 hook 会直接崩。

`App.tsx` 另需把 `/api/diagnose` 返回的 `assessmentId` 一路传到结果页。

---

## 6. 边界情况

| 情况 | 处理 |
|---|---|
| 用户名归一化后为空 / 超过 32 字符 | 400 |
| 密码短于 6 或长于 128 字符 | 400 |
| 注册时用户名已存在 | 409 |
| 登录时用户名不存在 **或** 密码错 | 401，**同一句文案**。注意这只保证文案与状态码不泄露，**不保证时序**——查不到用户名时不跑 scrypt，响应时间仍可分辨；而且注册对已占用用户名返回 409 本就泄露存在性。要么接受存在性可枚举，要么连注册一起改，只堵时序没有收益 |
| 会话过期 / 被篡改 | 401，前端跳登录 |
| 未配置 `JWT_SECRET` | 认证端点 503 |
| 查他人记录、或记录不存在 | 一律 404 |
| 数据库文件不存在 | store 建目录并建表 |
| 用户名大小写不同（`Alice` / `alice`） | 归一化后视为同一人 |

---

## 7. 不变量

**上下文只包含请求者本人的数据，且严格按来源过滤。**

这是 §4.2 第 4 条的准确表述（原文是「替别人测的记录不进入提问者的 agent 上下文」）。

v1.1 时这条的实现形式是「上下文只由单一记录构造」，因为那时上下文里就只有那一条。
v1.2 起上下文绑到了用户（§11.4），单一记录不再成立——但**要防的事情没变**：混用。
所以不变量改写成两条可检查的规则：

1. **归属**：上下文里的任何一条记录、任何一轮对话，`user_id` 都必须等于请求者。
   不是本人的一律不进去（`assessmentId` 不是本人的照旧 404，见 §4.2 末段）。
2. **来源**：`source='other'` 的测评**数据**永不进入上下文。`source='other'` 的
   **对话轮次**只有在用户当前正查看那条记录时才进入——否则在「测测别人」的页面上
   就没法连续追问。一旦离开那条记录，那些轮次立即不在上下文里。

第 2 条不是洁癖：`other` 记录装的是别人的画像，混进来就是 §4.2 第 4 条要防的
「拿别人的画像解释你」。

**代码注释与主文档 §4.2 都要按这两条改写**——旧的「只由单一记录构造」说法在
v1.2 之后是错的，留着会误导后来者以为多记录上下文违规。

---

## 8. 测试策略

沿用现有各包的 vitest 配置。`createApp` 的注入点扩为
`AppOptions { model?, jwtSecret?, store? }`——测试传内存库
（`new DatabaseSync(':memory:')`）与固定密钥，不碰真实文件。

| 层 | 用例 |
|---|---|
| `store` | 建表幂等；注册后可查回；用户名归一化去重；密码校验正确/错误；**追加语义**（同用户两条记录各自成行）；按用户倒序查询；按 id 查他人记录返回空；**解读补写**（写一次、只写 `interpretation`、`answers`/`result`/`source`/`created_at` 不变） |
| `auth` 路由 | 注册 201 + Set-Cookie；重复注册 409；用户名/密码越界 400；登录成功/失败 401；登出清 cookie；`me` 未登录 401；**未配置 `JWT_SECRET` 时 503**；空串 `JWT_SECRET=` 也走 503 |
| 落库 | `/api/diagnose` 后库里多一行且**返回 `assessmentId`**；`source` 与请求一致；`answers`/`result` 可 `JSON.parse` 回原形 |
| 解读持久化 | 流正常结束后写入**完整**全文；**半截流（中途报错）不写入**，`interpretation` 保持 `NULL`；`GET /api/assessments/:id` 能取回该全文 |
| `assessmentId` 入参 | `/api/interpret`、`/api/chat` 按 id 取记录，不再读请求体的 `answers`；**非本人的 id 返回 404**；`pathId` 不在该记录 `result` 里返回 404 |
| 上下文 | 沿现有 `packages/llm/src/context.test.ts` 的口径，钉住上下文只含**当前那一条**记录；新钉一条：传入预置 `result` 时上下文用的是它，不是重算结果 |
| 前端 | 未登录时渲染 Login；登录后进选对象；History 列出历次并点进 ResultView；**`interpretation` 非空时不再调 `/api/interpret`** |

---

## 9. 对主文档的修改

这批同步更新主文档，五处：

1. **§9.1 页面结构**——流程图补登录步骤：
   `首页 → 登录/注册 → 选择测评对象 → 诊断问卷 → 诊断结果页 → 追问对话`；
   并注明「知识库可独立访问」不受登录门槛影响。
2. **§3.4 HTTP 接口**——补账号与测评记录端点；`/api/interpret` 与 `/api/chat` 的
   入参说明改为 `assessmentId`；删掉「§4.2 的测评记录留存尚未对应任何端点」那段
   过时注记。
3. **§4.2 第 4 条**——改成 §7 的不变量措辞，并指向本文件。
4. **§4.2 的留存表格**——补一行「个性化解读」，注明是对原文的扩展。
5. **`packages/llm/src/index.ts` 里 `sliceOf` 的注释**——那句「服务端自己重算诊断，
   不接受客户端传来的结果（§5.1 确定性）」有两处问题：措辞要松弛成「结果只能来自
   服务端自己：重算，或读本服务端落库的快照」，**引用也标错了**（§5.1 是出题原则，
   该原则在 §1.3 与 §4.1）。一并改掉。

另可顺带补 **§3.2 目录结构**（`apps/api` 下的 `auth.ts` / `store.ts` / `data/`）。

### 9.1 v1.2（§11）新增的主文档修改

上面五处已在 v1.2 落地，§11 又带来四处：

6. **§8.2 解读的输出结构**——三段改四段，插入「你的变化」（§11.5）；同期改动
   §8.2 里「解读场景的输入构造」一段：上下文不再只有当次测评，还含最近 4 次自我测评
   摘要与账号级对话（§11.4）。
7. **§4.2 第 4 条**——上面第 3 条已改过一次（单一记录 → 不变量措辞）。**v1.2 要再改
   一次**：上下文绑到用户之后，单一记录的说法不再成立，改成本文件 §7 的归属 + 来源
   两条规则。
8. **§9.1 / §9.2**——对话区改为账号级：不是「就这条路径追问」，而是接着整条账号对话
   流聊；界面上的位置可以不动，但口径要写清。
9. **主文档版本升到 v1.3**，附修订摘要。

---

## 10. 与硬性约束的关系

| 约束 | 本设计如何满足 |
|---|---|
| 推荐结果由 core 确定性算法得出 | 落库不改变诊断链路；`result` 就是 core 的输出快照 |
| 知识库内容不得编造 | 无关 |
| 新块类型不得导致构建失败 | 无关 |
| `.env` 必须留在 `.gitignore` | `JWT_SECRET` 走 `.env`；`.env.example` 留空占位 |
| 推荐逻辑改动须同步黄金案例集 | 本设计不动推荐逻辑 |
| 前端不得出现 API Key | 前端只持有 httpOnly cookie，连 JWT 都读不到 |
| 不得硬编码知识库内容 | 无关 |
| 上下文不得混入他人画像 | §7 的归属 + 来源两条规则；`source='other'` 的测评数据永不进上下文（§11.4） |

新增一条同级保护：**`apps/api/data/` 必须进 `.gitignore`**（密码哈希不得提交）。

---

## 11. 账号级对话与用户绑定上下文（v1.2 新增）

### 11.1 要解决什么

两条需求（来源：团队的需求记录，2026-10-03 确认）：

1. **agent 上下文与用户绑定。** 现在上下文只看当次测评——换一次测评就「失忆」，
   上一轮的画像与推荐给不出任何参照。
2. **同一账号内历史对话互通。** 现在对话锚在「记录 × 路径」上：换条路径、换次测评、
   重开页面，前面聊的全没了。

这两条与 §7 的旧措辞（「上下文只由单一记录构造」）直接冲突。**冲突的是实现形式，
不是要防的事**——§7 要防的是混用，而 §4.2 第 4 条早就写明了扩展的路子：
「谁将来想把多条历史喂进上下文，必须先按来源过滤」。本节就是按那条路子做的。

### 11.2 数据模型：`messages` 表

```sql
CREATE TABLE IF NOT EXISTS messages (
  id            TEXT PRIMARY KEY,   -- crypto.randomUUID()
  user_id       TEXT NOT NULL REFERENCES users(id),
  assessment_id TEXT,               -- 这一轮是在哪条测评下产生的
  path_id       TEXT,               -- 当时正在看哪条路径
  source        TEXT NOT NULL CHECK (source IN ('self','other')),
                                    -- 来源在写入时就知道且永不改变。冗余在这里，
                                    -- 来源过滤就成了一条 WHERE，不必 JOIN 回 assessments
  role          TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content       TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_user
  ON messages(user_id, created_at);
```

`assessment_id` / `path_id` 可空：它们只用来做 §11.4 的来源过滤与「当时在看什么」
的语境提示，不是外键约束（记录被删时对话不该跟着消失——虽然现在没有删除功能）。

### 11.3 服务端是对话的真相源

现在的 `/api/chat` 让客户端把整段对话历史传上来。改掉：

| 端点 | 现在 | 改为 |
|---|---|---|
| `POST /api/chat` | 入 `{assessmentId, pathId, messages[]}` | 入 **`{assessmentId, pathId, question}`**（只发本轮的新问题） |
| `GET /api/chat/history` | — | **新增**：该账号最近的对话轮次，供前端首次渲染 |

服务端的处理顺序：

1. 按 `sessionUser` 取该用户的最近 N 轮对话（§11.4 的过滤规则）
2. 组装上下文（§11.4）
3. 写入本轮 **user** 消息
4. 流式回答
5. **流正常结束后**才写入 **assistant** 消息

**第 5 步必须复用 §4.7 的 `finishReason` 闸门。** 同一类失效在这里同样致命：模型中途
断开时 `.text` 会静默 resolve 出半截文本，把半截回答写进对话流之后，它就成了后续所有
上下文的既定事实。

**user 与 assistant 两条一起写，只在流正常结束后。** 失败的轮次什么都不落库——否则
上下文里会留下「用户问了但没人答」的悬空轮次，模型看到会困惑。代价是失败的提问在历史里
不可见；用户重问即可。这与解读「只保存完整的」是同一条原则。

**这同时消掉了「客户端可以伪造对话历史」这个面。** 与 `assessmentId` 一样：记录是服务端
写的，客户端改不了。

### 11.4 上下文怎么组装

上下文由三块构成，块内按下面的上限封顶：

| 块 | 内容 | 上限 |
|---|---|---|
| 当次 | 当前正在查看的那条记录：完整 `DiagnosisResult` + 逐题作答 + 该路径全文 | 1 条 |
| 历次自我测评 | 该用户最近 4 次 `source='self'` 测评**除当次之外**的摘要：8 维分数、主推荐路径、时间 | 4 条 |
| 对话 | 按来源过滤后的最近 N 轮 | 20 轮（沿用现有 `MAX_CHAT_MESSAGES`） |

**来源过滤规则（§7 不变量的落地）**：

- 历次自我测评块只取 `source='self'`
- 对话块纳入：锚点是 `source='self'` 测评的轮次，**以及**锚点等于「当前正在查看的
  那条记录」的轮次（无论其来源）

第二条是为了让「测测别人」的页面也能连续追问——否则一问一答都接不上。一旦用户离开
那条记录，那些轮次立即不在上下文里。

过滤**只看 `source` 列**（写入时定死、有 `NOT NULL` 约束），不依赖 `assessment_id`
是否为空。`assessment_id` 为 `NULL` 只意味着「这一轮没有锚定到某条记录」，
与来源无关。

### 11.5 解读改四段

输出结构从三段改为四段：

1. 你现在的位置
2. 为什么推荐这条路径
3. **你的变化**（新增）
4. 接下来关注什么

**首次测评时「你的变化」段写什么**：当次之前没有任何 `source='self'` 测评时，这一段
**照实说这是第一次测评、还看不出变化**，并给一句这对后续意味着什么。不编造对比——
编造一份「上次」正好违背产品承诺。

### 11.6 提示词改动

**`interpret.md`**

- 输出要求改四段（见 §11.5）
- 新增约束：**除「你的变化」段以外，不要主动做跨次对比**——按最近一次分析

**`chat.md`**

- 追问的锚点从「本路径」改为「当前正在查看的记录与路径」；对话是连续的，不要重复
  自我介绍或重复已经说过的结论
- 新增约束：**上下文里有多次自我测评数据，用户没有明确提出对比时，不要主动对比**，
  按最近一次分析

> **两处约束看似打脸的说明**：§11.5 要求解读主动产出「你的变化」段，§11.6 又说不许
> 主动对比。二者作用域不同——「你的变化」是**规定好的输出段落**（解读每次都产），
> 「不要主动对比」约束的是**其余段落与追问**（别在用户没问时自己扯起对比）。
> 这是对需求原话「如果有多段自我评测数据而用户没有明确提出要进行对比，则不要主动对比，
> 而是按照最近一次分析」的解读，**若与团队本意不符，以此处为准前请先确认**。

### 11.7 边界

| 情况 | 处理 |
|---|---|
| 首次测评（无历史） | 上下文只有当次；解读的「你的变化」段照实说明（§11.5） |
| 只有 1 次自我测评 | 同上——1 次不构成「变化」 |
| 对话为空 | 对话块省略，不留空标题 |
| 流中途断开 | 本轮两条消息都不写（§11.3） |
| 用户换了账号 | 上下文完全隔离，`user_id` 是第一道也是最后一道过滤 |
| 对话流无限增长 | 上下文只取最近 20 轮；库里全留（与测评记录的追加语义一致） |

### 11.8 连带修改

**代码**

- `packages/llm`：`KnowledgeSlice` 扩为携带「历次自我测评摘要」与「已过滤的对话轮次」；
  `buildSystemContent` 在现有段落序列里插入两块
- `apps/api`：`store.ts` 加 `messages` 表与读写；`/api/chat` 按 §11.3 改造；
  新增 `GET /api/chat/history`
- `apps/web`：`PathAssistant` 的对话区改为向服务端读历史、只发本轮问题

**文档**

- 主文档 §8.2 输出结构：三段 → 四段
- 主文档 §4.2 第 4 条：按 §7 的新措辞改写
- 主文档 §9.1 / §9.2：说清对话区是账号级的
- 主文档版本升到 v1.3

**测试**

- `packages/llm/src/prompts.test.ts`：三段断言改四段
- 新增：来源过滤（`other` 的测评数据永不进上下文、`other` 的对话只在查看该记录时进）
- 新增：对话写入只在流正常结束后发生（半截流不写）
- 新增：首次测评时「你的变化」段照实说明

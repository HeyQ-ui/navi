# Navi 账号与存储 · 专项设计

> 本文件是「账号与存储」专项的设计真相源。它**扩展**主文档
> `2026-09-27-navi-career-planning-agent-design.md`（下称主文档），不重复其内容。
> 与主文档冲突处以本文件为准，并回头修正主文档（见 §9）。
>
> 主文档 §4.2 已定下测评记录留存的四条约束，同时明确把「账号模型、存储介质、
> 追加语义、会话与上下文的绑定」划归独立专项。本文件补齐这一块。

**状态**：设计已定，待评审。

---

## 1. 范围

### 1.1 交付

| # | 交付物 | 对应主文档 |
|---|---|---|
| 1 | 用户注册与登录（用户名 + 密码） | 本文件新立 |
| 2 | 会话（httpOnly cookie 中的 JWT） | 本文件新立 |
| 3 | 测评记录落库，满足四条留存约束 | §4.2 |
| 4 | 只读历史列表界面 | 本文件新立 |
| 5 | 「测测自己 / 测测别人」入口 | §9.1（已写明，尚未实现） |

### 1.2 明确不做

- 密码找回、邮箱验证、第三方登录
- 登出全部设备、会话主动吊销
- 历史记录的删除 / 编辑
- 追问对话历史的持久化（§4.2 未要求）
- 把测评历史喂进 agent 上下文（见 §7，这是不变量而非功能）

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

两张表，覆盖 §4.2 表格的全部四行。

```sql
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,      -- crypto.randomUUID()
  username      TEXT NOT NULL UNIQUE,  -- trim + 小写归一化后的值，见 §3.2
  password_hash TEXT NOT NULL,         -- scrypt 输出，hex
  salt          TEXT NOT NULL,         -- 16 字节随机盐，hex
  created_at    TEXT NOT NULL          -- ISO 8601
);

CREATE TABLE IF NOT EXISTS assessments (
  id         TEXT PRIMARY KEY,         -- crypto.randomUUID()
  user_id    TEXT NOT NULL REFERENCES users(id),
  source     TEXT NOT NULL CHECK (source IN ('self','other')),  -- §4.2 第 1、4 条
  grade      TEXT,                     -- 测评时选的年级
  answers    TEXT NOT NULL,            -- JSON: QuestionId -> 0..4   §4.2「完整作答」
  result     TEXT NOT NULL,            -- JSON: 完整 DiagnosisResult  §4.2 其余三行
  created_at TEXT NOT NULL
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

### 3.2 三处刻意的取舍

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
| `GET` | `/api/assessments/:id` | — | `200 {..., answers, result, paths, tiedPaths}` / `401` / `404` |

失败码：

- `400` 用户名或密码不合规（长度越界）
- `401` 登录失败；未登录访问受保护端点
- `404` 记录不存在**或不属于本人**——两种情况合并成 404，不泄露他人记录的存在性
- `409` 注册时用户名已被占用
- `503` 未配置 `JWT_SECRET`（见 §4.4）

`GET /api/assessments` 的每条列表项：

```ts
{ id, source, grade, createdAt, mainPathId, match }
```

`mainPathId` / `match` 从该条 `result` 上用 core 的 `findTiedPaths` 得出，与结果页
口径一致（主文档 §9.3），不另立算法。列表不渲染并列提示，所以列表项不带 `tiedPaths`
——那是详情响应的事。

`GET /api/assessments/:id` 自带宽渲染结果页所需的 `paths` 摘要（与 `/api/questions`
下发的同形），使历史详情成为**一次**请求，不依赖第二次往返。

### 4.2 受限与公开的界线

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

### 4.3 落库时机

落库在 `POST /api/diagnose` **服务端内部**：一次请求，服务端手里已经有 `answers`
和刚算出的 `result`，追加一行即可。不让客户端另发一次保存请求——那样既要多一次往返，
又要把「存什么」交给不可信的客户端。

追加语义（§4.2 第 2 条）由此天然成立：这个端点只 `INSERT`，从不 `UPDATE` 已有行。
同一用户重复提交同一份答案会得到两条独立记录，这正是「历史不丢」要的行为。

### 4.4 `JWT_SECRET` 缺失时 fail closed

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

### 4.5 cookie 与会话

- 名字 `navi_session`，JWT payload `{ sub: userId, username }`，有效期 7 天
- `HttpOnly`（前端 JS 读不到，杜绝 XSS 窃取）、`SameSite=Lax`、`Path=/`
- `Secure` 仅在非本地环境加（dev 是 http）
- 登出即 `Max-Age=0` 覆盖同名 cookie

`SameSite=Lax` + vite proxy 就够：前端用相对路径 `/api/...`，vite 已代理到 `:3000`，
浏览器看到的是**同源**，cookie 自动带上——不需要 CORS，也不需要改 `credentials`。
生产同源部署同理。

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

### 5.2 历史详情提供解读与追问（当场重算）

点进历史记录后，解读与追问**可用**，且是**当场重新生成**的，不是快照。因为
`answers` 已完整留存，`/api/interpret` 与 `/api/chat` 的既有入参就能跑，不需要任何
改动。

这不违反 §4.2 第 4 条——那条防的是**混用**（拿别人的画像解释你），而这里是用户
主动打开的一条规定记录，上下文只由它自己的 `answers` 构造。不变量的准确措辞见 §7。

---

## 6. 边界情况

| 情况 | 处理 |
|---|---|
| 用户名归一化后为空 / 超过 32 字符 | 400 |
| 密码短于 6 或长于 128 字符 | 400 |
| 注册时用户名已存在 | 409 |
| 登录时用户名不存在 **或** 密码错 | 401，**同一句文案**，不泄露用户是否存在 |
| 会话过期 / 被篡改 | 401，前端跳登录 |
| 未配置 `JWT_SECRET` | 认证端点 503 |
| 查他人记录、或记录不存在 | 一律 404 |
| 数据库文件不存在 | store 建目录并建表 |
| 用户名大小写不同（`Alice` / `alice`） | 归一化后视为同一人 |

---

## 7. 不变量

**上下文只由单一记录构造，且只由当前请求显式指定的那一份。**

这是 §4.2 第 4 条的准确表述。当前架构天然满足：`packages/llm` 的
`sliceOf(answers, bundle, pathId)` 只接受当前请求 body 里的 `answers`，历史上任何
记录都进不去。所以这不是要建的功能，而是要**守住**的性质。

明确后果：**谁将来想把历史喂进上下文，必须先按 `source` 过滤**，把 `other` 的记录
排除在外。这句话要写进代码注释与主文档 §4.2。

---

## 8. 测试策略

沿用现有各包的 vitest 配置。`createApp` 的注入点扩为
`AppOptions { model?, jwtSecret?, store? }`——测试传内存库
（`new DatabaseSync(':memory:')`）与固定密钥，不碰真实文件。

| 层 | 用例 |
|---|---|
| `store` | 建表幂等；注册后可查回；用户名归一化去重；密码校验正确/错误；**追加语义**（同用户两条记录各自成行）；按用户倒序查询；按 id 查他人记录返回空 |
| `auth` 路由 | 注册 201 + Set-Cookie；重复注册 409；用户名/密码越界 400；登录成功/失败 401；登出清 cookie；`me` 未登录 401；**未配置 `JWT_SECRET` 时 503**；空串 `JWT_SECRET=` 也走 503 |
| 落库 | `/api/diagnose` 后库里多一行；`source` 与请求一致；`answers`/`result` 可 `JSON.parse` 回原形 |
| 不变量 | 沿现有 `packages/llm/src/context.test.ts` 的口径，钉住上下文只含当前记录 |
| 前端 | 未登录时渲染 Login；登录后进选对象；History 列出历次并点进 ResultView |

---

## 9. 对主文档的修改

这批同步更新主文档，三处：

1. **§9.1 页面结构**——流程图补登录步骤：
   `首页 → 登录/注册 → 选择测评对象 → 诊断问卷 → 诊断结果页 → 追问对话`；
   并注明「知识库可独立访问」不受登录门槛影响。
2. **§3.4 HTTP 接口**——补账号与测评记录端点；删掉「§4.2 的测评记录留存尚未对应
   任何端点」那段过时注记。
3. **§4.2 第 4 条**——改成 §7 的不变量措辞，并指向本文件。

另可顺带补 **§3.2 目录结构**（`apps/api` 下的 `auth.ts` / `store.ts` / `data/`）。

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

新增一条同级保护：**`apps/api/data/` 必须进 `.gitignore`**（密码哈希不得提交）。

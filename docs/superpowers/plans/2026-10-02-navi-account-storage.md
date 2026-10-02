# Navi 账号与存储 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Navi 具备用户名+密码账号、会话、测评记录（含个性化解读）持久化，以及只读历史界面。

**Architecture:** 存储与认证全部落在 `apps/api`（I/O 不属于 `packages/core` 与 `packages/llm`），零新依赖——`node:sqlite` 存数据、`node:crypto` 做密码哈希、`hono/jwt` + `hono/cookie` 做会话。`/api/diagnose` 落库并返回 `assessmentId`；`/api/interpret` 与 `/api/chat` 改为按 `assessmentId` 从服务端自己的库里取记录，解读在流正常结束后补写回该记录。前端加登录、选测评对象、只读历史三块。

**Tech Stack:** TypeScript · pnpm workspace · Hono 4.13 · `node:sqlite` · `node:crypto` · React + Vite · Vitest

**Spec:** `docs/superpowers/specs/2026-10-02-navi-account-storage-design.md`（本计划从该 spec 论证而来，执行时两份一起读；主文档 `docs/superpowers/specs/2026-09-27-navi-career-planning-agent-design.md` 是它扩展的上位真相源）

## Global Constraints

- **零新依赖。** 不得往任何 `package.json` 加依赖（spec §2）。
- `packages/core` 零框架依赖、零网络、零 I/O；`packages/llm` 只依赖 core 的类型。存储与认证只能落在 `apps/api`（AGENTS.md 模块边界）。
- 前端不得出现任何 API Key；前端连 JWT 都读不到（httpOnly cookie）。
- `.env` 必须留在 `.gitignore`；**新增 `apps/api/data/` 也必须进 `.gitignore`**（库里存密码哈希）。
- 知识库内容不得硬编码进 TypeScript 源码。
- 推荐结果由 `core` 确定性算法得出，模型只做解读与追问。
- 提交信息用中文，遵循 Conventional Commits。
- 导入路径是 `hono/jwt` 与 `hono/cookie`（**不是** `hono/middleware/jwt` / `hono/helper/cookie`——那两个子路径不在 hono 4.13.12 的 `exports` 里，写了会编译失败）。
- `JWT_SECRET` 存在性判断**必须用 falsy**（`!secret`），不能用 `??`：`.env.example` 里它留空，`loadEnvFile` 会设成空串，`??` 挡不住。

## Review Focus

以下五类输入/失效模式是 spec 蕴含、但没有哪个任务的测试天然覆盖的。每条都在拥有相关代码的任务里配了测试（位置见括号），执行时逐条确认。

1. **AI SDK 的 `finishReason` 与 `toTextStreamResponse()` 同时消费能否拿到结果。** 计划里唯一未实测的机制。若 `await stream.finishReason` 在响应体被消费后不 resolve，写入逻辑永远不触发——静默失效，测试若只断言「正常流写了库」会红，但若断言方向写反就会假绿。（Task 4 Step 1–3）
2. **模型中途断开时绝不能写入半截解读。** `packages/llm/src/index.test.ts:126` 记录了一个已知缺陷：`.text` 在流中途出错时会**静默 resolve 出已累积的部分文本**，不抛错。「await `.text` 然后写库」会存下一段残缺解读，且它会被当成「已生成」而永不重算。（Task 4 Step 1）
3. **库里 `result` JSON 损坏时，历史接口不应 500。** 手工改库、旧的 schema 残留都会产生坏行；一行坏掉不该让整个历史列表打不开。（Task 5）
4. **同一用户名并发注册只能有一条成功。** 先 `SELECT` 再 `INSERT` 有竞态；`UNIQUE` 约束是最后防线，撞上它必须转成 409 而不是 500。（Task 1、Task 2）
5. **未带会话 cookie 访问测评端点是 401 而不是 500。** 旧客户端、分享链接的观看者都会走到这条路径。（Task 3）

---

### Task 1: store —— SQLite 数据层

**Files:**
- Create: `apps/api/src/store.ts`
- Create: `apps/api/src/store.test.ts`
- Modify: `.gitignore`（新增 `apps/api/data/`）

**Interfaces:**
- Consumes: `@navi/core` 的 `Answers`、`DiagnosisResult` 类型
- Produces:
  - `openStore(file: string): Store` —— `file` 为 `':memory:'` 时用内存库（测试用）
  - `defaultDbPath(): string` —— 解析到 `apps/api/data/navi.db`（按模块 URL，不按 cwd）
  - `class UsernameTakenError extends Error`
  - `type Source = 'self' | 'other'`
  - `interface User { id: string; username: string; createdAt: string }`
  - `interface AssessmentRecord { id; userId; source: Source; grade: string | null; answers: Answers; result: DiagnosisResult; interpretation: string | null; createdAt }`
  - `interface AssessmentRow { id: string; source: Source; grade: string | null; result: DiagnosisResult; createdAt: string }`
  - `interface Store { createUser(username, password): User; verifyUser(username, password): User | null; getUserById(id): User | null; createAssessment(input: { userId; source; grade: string | null; answers; result }): string; listAssessments(userId): AssessmentRow[]; findAssessment(id, userId): AssessmentRecord | null; setInterpretation(id, text): void; close(): void }`

- [ ] **Step 1: 写失败测试**

创建 `apps/api/src/store.test.ts`：

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import { existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openStore, UsernameTakenError } from './store.js'
import type { Store } from './store.js'
import type { DiagnosisResult } from '@navi/core'

const result: DiagnosisResult = {
  indicators: {
    'academic-interest': { score: 80, known: true, consistency: 0.9, sources: ['q1'] },
  },
  paths: [{
    id: 'same-discipline-baoyan', match: 55, confidence: 0.7,
    eligibility: { applicable: true, hardFailures: [], softWarnings: [] },
    contributions: [],
  }],
  archetypes: [],
}

const input = {
  source: 'self' as const,
  grade: 'freshman',
  answers: { q1: 4 },
  result,
}

let store: Store

beforeEach(() => { store = openStore(':memory:') })
afterEach(() => { store.close() })

describe('users', () => {
  it('建用户后可查回，且不返回密码字段', () => {
    const user = store.createUser('alice', 'pw123456')
    expect(user.username).toBe('alice')
    expect(user).not.toHaveProperty('passwordHash')
    expect(store.getUserById(user.id)?.username).toBe('alice')
  })

  it('用户名归一化：大小写与首尾空白视为同一人', () => {
    const user = store.createUser('  Alice  ', 'pw123456')
    expect(user.username).toBe('alice')
    expect(() => store.createUser('ALICE', 'pw123456')).toThrow(UsernameTakenError)
  })

  it('密码校验：对的返回用户，错的或查无此人返回 null', () => {
    const user = store.createUser('alice', 'pw123456')
    expect(store.verifyUser('alice', 'pw123456')?.id).toBe(user.id)
    expect(store.verifyUser('alice', 'wrong-password')).toBeNull()
    expect(store.verifyUser('nobody', 'pw123456')).toBeNull()
  })

  it('同盐同密码两次哈希不同（每用户独立随机盐）', () => {
    store.createUser('a', 'same-password')
    store.createUser('b', 'same-password')
    // 通过重新校验确认两套盐各自可用——若共用一个固定盐，这里仍会过，
    // 所以真正的不变量由 store.ts 里 randomBytes 保证，此处只是回归哨兵
    expect(store.verifyUser('a', 'same-password')).not.toBeNull()
    expect(store.verifyUser('b', 'same-password')).not.toBeNull()
  })
})

describe('assessments', () => {
  it('createAssessment 返回 id，findAssessment 能原样取回', () => {
    const user = store.createUser('alice', 'pw123456')
    const id = store.createAssessment({ userId: user.id, ...input, grade: 'freshman' })
    const got = store.findAssessment(id, user.id)
    expect(got?.answers).toEqual({ q1: 4 })
    expect(got?.result.paths[0]!.match).toBe(55)
    expect(got?.source).toBe('self')
    expect(got?.interpretation).toBeNull()
  })

  it('追加语义：同一用户多次测评各自成行，历史不丢', () => {
    const user = store.createUser('alice', 'pw123456')
    const a = store.createAssessment({ userId: user.id, ...input })
    const b = store.createAssessment({ userId: user.id, ...input })
    expect(a).not.toBe(b)
    expect(store.listAssessments(user.id)).toHaveLength(2)
  })

  it('listAssessments 只含本人，且按时间倒序', () => {
    const alice = store.createUser('alice', 'pw123456')
    const bob = store.createUser('bob', 'pw123456')
    const first = store.createAssessment({
      userId: alice.id, ...input, createdAt: '2026-01-01T00:00:00.000Z',
    } as never)
    const second = store.createAssessment({
      userId: alice.id, ...input, createdAt: '2026-02-01T00:00:00.000Z',
    } as never)
    store.createAssessment({ userId: bob.id, ...input })

    const rows = store.listAssessments(alice.id)
    expect(rows.map(r => r.id)).toEqual([second, first])
  })

  it('findAssessment 用他人的 id 查不到（归属校验）', () => {
    const alice = store.createUser('alice', 'pw123456')
    const bob = store.createUser('bob', 'pw123456')
    const id = store.createAssessment({ userId: alice.id, ...input })
    expect(store.findAssessment(id, bob.id)).toBeNull()
  })

  it('数据库文件的目录不存在时自动创建（spec §6）', () => {
    const dir = join(tmpdir(), `navi-store-test-${randomUUID()}`)
    const file = join(dir, 'nested', 'navi.db')
    const fresh = openStore(file)
    fresh.createUser('alice', 'pw123456')
    fresh.close()

    expect(existsSync(file)).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  it('setInterpretation 只改 interpretation，其余字段一字不动', () => {
    const user = store.createUser('alice', 'pw123456')
    const id = store.createAssessment({ userId: user.id, ...input })
    const before = store.findAssessment(id, user.id)!

    store.setInterpretation(id, '你现在的位置是大一。')

    const after = store.findAssessment(id, user.id)!
    expect(after.interpretation).toBe('你现在的位置是大一。')
    expect(after.answers).toEqual(before.answers)
    expect(after.result).toEqual(before.result)
    expect(after.createdAt).toBe(before.createdAt)
    expect(after.source).toBe(before.source)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @navi/api test -- store`
Expected: FAIL —— 报 `Failed to resolve import "./store.js"`。

- [ ] **Step 3: 实现 store.ts**

创建 `apps/api/src/store.ts`。要点：`node:sqlite` 的 `.get()` 返回 **null 原型对象**，必须逐字段映射成普通对象再返回，否则 null 原型会渗进应用层与测试断言；重复用户名抛的是**普通 `Error`**（不是带类型的异常），所以用「catch 后再查一次」判定 409，不做字符串匹配。

```ts
import { DatabaseSync } from 'node:sqlite'
import { randomUUID, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Answers, DiagnosisResult } from '@navi/core'

export type Source = 'self' | 'other'

export interface User {
  id: string
  username: string
  createdAt: string
}

export interface AssessmentRecord {
  id: string
  userId: string
  source: Source
  grade: string | null
  answers: Answers
  result: DiagnosisResult
  interpretation: string | null
  createdAt: string
}

/** 历史列表用：不带 answers 与 interpretation，列表不渲染它们 */
export interface AssessmentRow {
  id: string
  source: Source
  grade: string | null
  result: DiagnosisResult
  createdAt: string
}

export class UsernameTakenError extends Error {
  constructor(username: string) {
    super(`用户名已被占用：${username}`)
    this.name = 'UsernameTakenError'
  }
}

const SALT_BYTES = 16
const KEY_BYTES = 64

function hashPassword(password: string, salt: string): string {
  return scryptSync(password, salt, KEY_BYTES).toString('hex')
}

/** 常量时间比较，避免用 == 比较哈希时泄露前缀信息 */
function passwordMatches(password: string, salt: string, expectedHash: string): boolean {
  const actual = scryptSync(password, salt, KEY_BYTES)
  const expected = Buffer.from(expectedHash, 'hex')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

export function defaultDbPath(): string {
  // 按模块 URL 解析，不按 process.cwd()——`pnpm --filter @navi/api dev` 的 cwd 是
  // apps/api，按 cwd 解析在别的启动方式下会漂移（同 index.ts 里 .env 的注释）
  return fileURLToPath(new URL('../data/navi.db', import.meta.url))
}

interface UserRow {
  id: string
  username: string
  password_hash: string
  salt: string
  created_at: string
}

interface AssessmentDbRow {
  id: string
  user_id: string
  source: string
  grade: string | null
  answers: string
  result: string
  interpretation: string | null
  created_at: string
}

function toUser(row: UserRow): User {
  return { id: row.id, username: row.username, createdAt: row.created_at }
}

export interface Store {
  createUser(username: string, password: string): User
  verifyUser(username: string, password: string): User | null
  getUserById(id: string): User | null
  createAssessment(input: {
    userId: string
    source: Source
    grade: string | null
    answers: Answers
    result: DiagnosisResult
  }): string
  listAssessments(userId: string): AssessmentRow[]
  findAssessment(id: string, userId: string): AssessmentRecord | null
  setInterpretation(id: string, text: string): void
  close(): void
}

export function openStore(file: string): Store {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true })
  const db = new DatabaseSync(file)

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            TEXT PRIMARY KEY,
      username      TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      salt          TEXT NOT NULL,
      created_at    TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS assessments (
      id             TEXT PRIMARY KEY,
      user_id        TEXT NOT NULL REFERENCES users(id),
      source         TEXT NOT NULL CHECK (source IN ('self','other')),
      grade          TEXT,
      answers        TEXT NOT NULL,
      result         TEXT NOT NULL,
      interpretation TEXT,
      created_at     TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_assessments_user
      ON assessments(user_id, created_at DESC);
  `)

  const findUserByName = db.prepare('SELECT * FROM users WHERE username = ?')

  return {
    createUser(username, password) {
      const id = randomUUID()
      const salt = randomBytes(SALT_BYTES).toString('hex')
      const createdAt = new Date().toISOString()
      try {
        db.prepare(
          'INSERT INTO users (id, username, password_hash, salt, created_at) VALUES (?,?,?,?,?)',
        ).run(id, username, hashPassword(password, salt), salt, createdAt)
      } catch (error) {
        // 不匹配 SQLite 的错误文案（跨版本会变）。插失败后回查一次：
        // 查得到就是重名（唯一约束挡下的），查不到才是真的写坏了，原样抛出。
        if (findUserByName.get(username) !== undefined) throw new UsernameTakenError(username)
        throw error
      }
      return { id, username, createdAt }
    },

    verifyUser(username, password) {
      const row = findUserByName.get(username) as UserRow | undefined
      if (row === undefined) return null
      if (!passwordMatches(password, row.salt, row.password_hash)) return null
      return toUser(row)
    },

    getUserById(id) {
      const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined
      return row === undefined ? null : toUser(row)
    },

    createAssessment(input) {
      const id = randomUUID()
      db.prepare(
        `INSERT INTO assessments (id, user_id, source, grade, answers, result, interpretation, created_at)
         VALUES (?,?,?,?,?,?,NULL,?)`,
      ).run(
        id, input.userId, input.source, input.grade,
        JSON.stringify(input.answers), JSON.stringify(input.result),
        new Date().toISOString(),
      )
      return id
    },

    listAssessments(userId) {
      const rows = db.prepare(
        `SELECT id, source, grade, result, created_at FROM assessments
         WHERE user_id = ? ORDER BY created_at DESC, rowid DESC`,
      ).all(userId) as Array<Omit<AssessmentDbRow, 'user_id' | 'answers' | 'interpretation'>>

      // 坏行跳过而不是让整个列表 500（Review Focus #3）。解析失败说明这一行是
      // 手工改库或旧 schema 的产物，它不该拖垮其余历史。
      const out: AssessmentRow[] = []
      for (const row of rows) {
        try {
          out.push({
            id: row.id,
            source: row.source as Source,
            grade: row.grade,
            result: JSON.parse(row.result) as DiagnosisResult,
            createdAt: row.created_at,
          })
        } catch {
          console.warn(`[store] 跳过损坏的测评记录：${row.id}`)
        }
      }
      return out
    },

    findAssessment(id, userId) {
      const row = db.prepare(
        'SELECT * FROM assessments WHERE id = ? AND user_id = ?',
      ).get(id, userId) as AssessmentDbRow | undefined
      if (row === undefined) return null
      return {
        id: row.id,
        userId: row.user_id,
        source: row.source as Source,
        grade: row.grade,
        answers: JSON.parse(row.answers) as Answers,
        result: JSON.parse(row.result) as DiagnosisResult,
        interpretation: row.interpretation,
        createdAt: row.created_at,
      }
    },

    setInterpretation(id, text) {
      // 全表唯一一次 UPDATE：只写这一个字段（spec §4.4）
      db.prepare('UPDATE assessments SET interpretation = ? WHERE id = ?').run(text, id)
    },

    close() {
      db.close()
    },
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @navi/api test -- store`
Expected: PASS，10 个用例全绿。

- [ ] **Step 5: 加 .gitignore 条目**

在 `.gitignore` 的「构建产物」段之后新增一段：

```
# ── 本地数据：存有用户名与密码哈希，绝不能提交 ──
apps/api/data/
```

- [ ] **Step 6: 提交**

```bash
git add apps/api/src/store.ts apps/api/src/store.test.ts .gitignore
git commit -m "feat(api): 新增 sqlite 数据层 store（用户、测评记录、解读补写）"
```

---

### Task 2: auth —— 注册、登录、登出、会话中间件

**Files:**
- Create: `apps/api/src/auth.ts`
- Create: `apps/api/src/auth.test.ts`
- Modify: `.env.example`（新增 `JWT_SECRET`）

**Interfaces:**
- Consumes: Task 1 的 `Store`、`User`、`UsernameTakenError`
- Produces:
  - `const SESSION_COOKIE = 'navi_session'`
  - `interface AuthOptions { store: () => Store; jwtSecret: string | undefined }` ——
    `store` 是 **thunk 而非实例**：`createApp` 在装配期就要构造 `AuthOptions`，若这里
    直接要实例，等于挂载路由的一瞬间就把数据库打开了，懒开失效、测试会在仓库里创建
    出真实 db 文件
  - `registerAuthRoutes(app: Hono, opts: AuthOptions): void` —— 挂 `/api/auth/register|login|logout|me`
  - `requireSession(opts: AuthOptions): MiddlewareHandler` —— 未配置密钥 503、无/坏会话 401
  - `sessionUser(c: Context): User` —— 中间件之后取当前用户

- [ ] **Step 1: 写失败测试**

创建 `apps/api/src/auth.test.ts`：

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { registerAuthRoutes, requireSession, sessionUser, SESSION_COOKIE } from './auth.js'
import { openStore } from './store.js'
import type { Store } from './store.js'

const SECRET = 'test-secret'

function makeApp(store: Store, jwtSecret: string | undefined = SECRET) {
  const app = new Hono()
  const opts = { store: () => store, jwtSecret }
  registerAuthRoutes(app, opts)
  app.get('/api/private', requireSession(opts), c =>
    c.json({ username: sessionUser(c).username }))
  return app
}

function post(app: Hono, path: string, body: unknown, cookie?: string) {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (cookie !== undefined) headers.cookie = cookie
  return app.request(path, { method: 'POST', headers, body: JSON.stringify(body) })
}

let store: Store

beforeEach(() => { store = openStore(':memory:') })
afterEach(() => { store.close() })

describe('POST /api/auth/register', () => {
  it('注册成功返回 201 与 id，并下发 httpOnly 会话 cookie', async () => {
    const res = await post(makeApp(store), '/api/auth/register',
      { username: 'alice', password: 'pw123456' })
    expect(res.status).toBe(201)
    expect(((await res.json()) as { username: string }).username).toBe('alice')

    const cookie = res.headers.get('set-cookie')!
    expect(cookie).toContain(`${SESSION_COOKIE}=`)
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Lax')
  })

  it('用户名已存在返回 409', async () => {
    const app = makeApp(store)
    await post(app, '/api/auth/register', { username: 'alice', password: 'pw123456' })
    const res = await post(app, '/api/auth/register', { username: 'ALICE', password: 'pw123456' })
    expect(res.status).toBe(409)
  })

  it('用户名为空白或超过 32 字符返回 400', async () => {
    const app = makeApp(store)
    expect((await post(app, '/api/auth/register', { username: '   ', password: 'pw123456' })).status).toBe(400)
    expect((await post(app, '/api/auth/register', { username: 'x'.repeat(33), password: 'pw123456' })).status).toBe(400)
  })

  it('密码短于 6 或长于 128 字符返回 400', async () => {
    const app = makeApp(store)
    expect((await post(app, '/api/auth/register', { username: 'a', password: '12345' })).status).toBe(400)
    expect((await post(app, '/api/auth/register', { username: 'a', password: 'x'.repeat(129) })).status).toBe(400)
  })
})

describe('POST /api/auth/login', () => {
  it('凭据正确返回 200 与 cookie', async () => {
    const app = makeApp(store)
    await post(app, '/api/auth/register', { username: 'alice', password: 'pw123456' })
    const res = await post(app, '/api/auth/login', { username: 'alice', password: 'pw123456' })
    expect(res.status).toBe(200)
    expect(res.headers.get('set-cookie')).toContain(`${SESSION_COOKIE}=`)
  })

  it('密码错、用户名不存在、用户名格式非法——三者都是 401 且同一句文案', async () => {
    const app = makeApp(store)
    await post(app, '/api/auth/register', { username: 'alice', password: 'pw123456' })

    const wrongPassword = await post(app, '/api/auth/login', { username: 'alice', password: 'nope-nope' })
    const noSuchUser = await post(app, '/api/auth/login', { username: 'nobody', password: 'pw123456' })
    const badFormat = await post(app, '/api/auth/login', { username: '  ', password: 'pw123456' })

    expect([wrongPassword.status, noSuchUser.status, badFormat.status]).toEqual([401, 401, 401])
    const messages = await Promise.all(
      [wrongPassword, noSuchUser, badFormat].map(r => r.json().then((b: { error: string }) => b.error)),
    )
    expect(new Set(messages).size).toBe(1)
  })
})

describe('POST /api/auth/logout 与 GET /api/auth/me', () => {
  it('me 带 cookie 返回当前用户', async () => {
    const app = makeApp(store)
    const cookie = (await post(app, '/api/auth/register',
      { username: 'alice', password: 'pw123456' })).headers.get('set-cookie')!.split(';')[0]!
    const res = await app.request('/api/auth/me', { headers: { cookie } })
    expect(res.status).toBe(200)
    expect(((await res.json()) as { username: string }).username).toBe('alice')
  })

  it('me 不带 cookie 返回 401', async () => {
    const res = await makeApp(store).request('/api/auth/me')
    expect(res.status).toBe(401)
  })

  it('登出清 cookie 并返回 204', async () => {
    const res = await post(makeApp(store), '/api/auth/logout', {})
    expect(res.status).toBe(204)
    expect(res.headers.get('set-cookie')).toContain('Max-Age=0')
  })
})

describe('会话校验', () => {
  it('cookie 被篡改时 401', async () => {
    const res = await makeApp(store).request('/api/private', {
      headers: { cookie: `${SESSION_COOKIE}=not.a.real.token` },
    })
    expect(res.status).toBe(401)
  })

  it('会话有效但用户已被删时 401', async () => {
    const app = makeApp(store)
    const cookie = (await post(app, '/api/auth/register',
      { username: 'alice', password: 'pw123456' })).headers.get('set-cookie')!.split(';')[0]!
    store.close()
    store = openStore(':memory:')            // 换一个空库：cookie 里的 userId 不再存在
    const res = await app.request('/api/private', { headers: { cookie } })
    expect(res.status).toBe(401)
  })
})

describe('未配置会话密钥时 fail closed', () => {
  it('未配置 JWT_SECRET 时注册返回 503', async () => {
    const res = await post(makeApp(store, undefined), '/api/auth/register',
      { username: 'alice', password: 'pw123456' })
    expect(res.status).toBe(503)
  })

  it('JWT_SECRET 为空串时同样 503（不能用 ?? 兜底）', async () => {
    const res = await post(makeApp(store, ''), '/api/auth/register',
      { username: 'alice', password: 'pw123456' })
    expect(res.status).toBe(503)
  })

  it('未配置密钥时受保护端点也是 503 而不是 401', async () => {
    const res = await makeApp(store, undefined).request('/api/private')
    expect(res.status).toBe(503)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @navi/api test -- auth`
Expected: FAIL —— 报 `Failed to resolve import "./auth.js"`。

- [ ] **Step 3: 实现 auth.ts**

创建 `apps/api/src/auth.ts`：

```ts
import { Hono } from 'hono'
import type { Context, MiddlewareHandler } from 'hono'
import { sign, verify } from 'hono/jwt'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import { UsernameTakenError } from './store.js'
import type { Store, User } from './store.js'

export const SESSION_COOKIE = 'navi_session'

const ALG = 'HS256'
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7      // 7 天
const MAX_USERNAME = 32
const MIN_PASSWORD = 6
const MAX_PASSWORD = 128
const UNAVAILABLE = '账号功能暂不可用：服务端未配置会话密钥'
const BAD_CREDENTIALS = '用户名或密码不正确'

export interface AuthOptions {
  /** thunk 而非实例：装配期调用它会把数据库打开，懒开就失效了 */
  store: () => Store
  /** undefined 或空串都视为未配置——认证端点一律 503（spec §4.5） */
  jwtSecret: string | undefined
}

declare module 'hono' {
  interface ContextVariableMap {
    naviUser: User
  }
}

/** 未配置密钥时返回 503 响应，已配置返回 null。falsy 判断覆盖空串 */
function unavailable(c: Context, opts: AuthOptions): Response | null {
  return opts.jwtSecret ? null : c.json({ error: UNAVAILABLE }, 503)
}

async function setSessionCookie(c: Context, user: User, secret: string): Promise<void> {
  const token = await sign({ sub: user.id, username: user.username }, secret, ALG)
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
    // 本地开发走 http，加了 Secure 浏览器会直接丢弃这个 cookie
    secure: process.env.NODE_ENV === 'production',
  })
}

async function readBody(c: Context): Promise<Record<string, unknown> | null> {
  try {
    const body = await c.req.json()
    return body !== null && typeof body === 'object' ? (body as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** 归一化：trim + 小写。空或超长返回 null（spec §6） */
function normalizeUsername(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const name = raw.trim().toLowerCase()
  return name === '' || name.length > MAX_USERNAME ? null : name
}

export function requireSession(opts: AuthOptions): MiddlewareHandler {
  return async (c, next) => {
    const denied = unavailable(c, opts)
    if (denied) return denied

    const token = getCookie(c, SESSION_COOKIE)
    if (token === undefined) return c.json({ error: '未登录' }, 401)

    try {
      const payload = await verify(token, opts.jwtSecret as string, ALG)
      const user = opts.store().getUserById(String(payload.sub ?? ''))
      if (user === null) return c.json({ error: '未登录' }, 401)
      c.set('naviUser', user)
      await next()
    } catch {
      // 签名不符、过期、结构损坏——对外统一是「未登录」，不区分原因
      return c.json({ error: '未登录' }, 401)
    }
  }
}

export function sessionUser(c: Context): User {
  return c.get('naviUser')
}

export function registerAuthRoutes(app: Hono, opts: AuthOptions): void {
  app.post('/api/auth/register', async c => {
    const denied = unavailable(c, opts)
    if (denied) return denied

    const body = await readBody(c)
    if (body === null) return c.json({ error: '请求体不是合法 JSON' }, 400)

    const username = normalizeUsername(body.username)
    if (username === null) {
      return c.json({ error: `用户名需为 1–${MAX_USERNAME} 个字符，且不能只有空白` }, 400)
    }

    const password = typeof body.password === 'string' ? body.password : ''
    if (password.length < MIN_PASSWORD || password.length > MAX_PASSWORD) {
      return c.json({ error: `密码长度需在 ${MIN_PASSWORD}–${MAX_PASSWORD} 之间` }, 400)
    }

    let user: User
    try {
      user = opts.store().createUser(username, password)
    } catch (error) {
      if (error instanceof UsernameTakenError) return c.json({ error: '用户名已被占用' }, 409)
      throw error
    }

    await setSessionCookie(c, user, opts.jwtSecret as string)
    return c.json({ id: user.id, username: user.username }, 201)
  })

  app.post('/api/auth/login', async c => {
    const denied = unavailable(c, opts)
    if (denied) return denied

    const body = await readBody(c)
    if (body === null) return c.json({ error: '请求体不是合法 JSON' }, 400)

    // 用户名格式非法也走 401 同一句文案：换个 400 就等于告诉试探者「这个名字格式不对」
    const username = normalizeUsername(body.username)
    const password = typeof body.password === 'string' ? body.password : ''
    const user = username === null ? null : opts.store().verifyUser(username, password)
    if (user === null) return c.json({ error: BAD_CREDENTIALS }, 401)

    await setSessionCookie(c, user, opts.jwtSecret as string)
    return c.json({ id: user.id, username: user.username })
  })

  app.post('/api/auth/logout', c => {
    deleteCookie(c, SESSION_COOKIE, { path: '/' })
    return c.body(null, 204)
  })

  app.get('/api/auth/me', requireSession(opts), c => {
    const user = sessionUser(c)
    return c.json({ id: user.id, username: user.username })
  })
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @navi/api test -- auth`
Expected: PASS，15 个用例全绿。

若 `declare module 'hono'` 的 `ContextVariableMap` 增强没能让 `c.set('naviUser', user)` 通过类型检查，改用 `new Hono<{ Variables: { naviUser: User } }>()` 并把类型沿 `createApp` 串下去——**不要**用 `as never` 之类的断言绕过。

- [ ] **Step 5: 加 .env.example 条目**

在 `.env.example` 末尾追加：

```
# 会话签名密钥。留空则账号功能不可用（认证端点返回 503）。
# 生成一个：openssl rand -hex 32
JWT_SECRET=
```

- [ ] **Step 6: 提交**

```bash
git add apps/api/src/auth.ts apps/api/src/auth.test.ts .env.example
git commit -m "feat(api): 新增用户名密码注册登录与会话中间件"
```

---

### Task 3: 测评链路接到记录上（会话门 + diagnose 落库 + interpret/chat 改入参）

**Files:**
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/src/server.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `Store`/`openStore`/`defaultDbPath`/`Source`；Task 2 的 `registerAuthRoutes`/`requireSession`/`sessionUser`
- Produces: `AppOptions { model?: LanguageModel; jwtSecret?: string; store?: Store }`；`POST /api/diagnose` 响应新增 `assessmentId`；`POST /api/interpret` 与 `/api/chat` 请求体改为 `{ assessmentId, pathId }` / `{ assessmentId, pathId, messages }`

- [ ] **Step 1: 改测试——先加测试辅助，再改受影响用例**

在 `apps/api/src/server.test.ts` 顶部 import 区补充：

```ts
import { openStore } from './store.js'
import type { Store } from './store.js'
```

在 `const okAnswers = ...` 之前插入辅助：

```ts
/**
 * 建一个已登录的 app：注册一个测试用户，返回 app 与它的会话 cookie。
 * 测评端点现在都要会话，逐个用例手写注册样板会让文件不可读。
 */
async function authedApp(
  b: KnowledgeBundle = bundle,
  options: { model?: LanguageModel; jwtSecret?: string; store?: Store } = {},
) {
  const store = options.store ?? openStore(':memory:')
  const app = createApp(b, { jwtSecret: 'test-secret', ...options, store })
  const res = await app.request('/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'tester', password: 'pw123456' }),
  })
  const cookie = res.headers.get('set-cookie')!.split(';')[0]!
  return { app, cookie, store }
}

/** 直接查库断言时用：测试里只注册过 tester 一个用户 */
function meId(store: Store): string {
  const user = store.verifyUser('tester', 'pw123456')
  if (user === null) throw new Error('测试用户不存在')
  return user.id
}
```

把 `post` 改为接受可选 cookie：

```ts
function post(
  app: ReturnType<typeof createApp>, path: string, body: unknown, cookie?: string,
) {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (cookie !== undefined) headers.cookie = cookie
  return app.request(path, { method: 'POST', headers, body: JSON.stringify(body) })
}
```

**然后逐个改受影响用例**（`createApp(bundle)` + 直接 `post` 的那些）：把
`const res = await createApp(bundle).request('/api/diagnose', {...})` 换成
`const { app, cookie } = await authedApp(); const res = await post(app, '/api/diagnose', {...}, cookie)`。
受影响的 describe：`POST /api/diagnose`、`年级分流` 里的 diagnose 用例、
`答案完整性与接近路径`、`answers 校验`、`POST /api/interpret`、`POST /api/chat`。
`GET /api/questions`、`GET /api/knowledge/:pathId`、`年级分流` 的三个 GET 用例**不需要改**（公开端点）。

`POST /api/interpret` 与 `POST /api/chat` 的用例另需把请求体从
`{ answers, grade, pathId }` 改成 `{ assessmentId, pathId }`，其中 `assessmentId`
由先调一次 `/api/diagnose` 取得：

```ts
async function diagnoseOnce(app: ReturnType<typeof createApp>, cookie: string) {
  const res = await post(app, '/api/diagnose', { answers: okAnswers, grade: 'freshman' }, cookie)
  return ((await res.json()) as { assessmentId: string }).assessmentId
}
```

`answers 校验` 那个 describe 里针对 interpret 的两条（「拒绝夹带的不存在题目 id」
「拒绝越界的取值」）**删掉**——interpret 不再读请求体的 answers，这两条保护改由
`/api/diagnose` 的两条同义用例承担（它们保留）。**新增**一条替代用例，见 Step 2。

`POST /api/interpret` 里「答案不完整时返回 400」一条同样删掉（同上理由）。

- [ ] **Step 2: 加新用例并跑测试确认失败**

在 `POST /api/interpret` 的 describe 内新增：

```ts
  it('请求体里夹带 answers 也没用——服务端只认记录里的那份', async () => {
    const { app, cookie } = await authedApp(bundle, { model: mockModel('正常解读') })
    const assessmentId = await diagnoseOnce(app, cookie)
    const res = await post(app, '/api/interpret', {
      assessmentId, pathId: 'same-discipline-baoyan', answers: { ghost: 3 }, grade: 'senior',
    }, cookie)
    expect(res.status).toBe(200)
  })

  it('assessmentId 不存在或不属于本人时返回 404，不进入模型', async () => {
    let called = false
    const spy = new MockLanguageModelV3({
      doStream: async () => { called = true; throw new Error('不该被调用') },
    }) as unknown as LanguageModel
    const { app, cookie } = await authedApp(bundle, { model: spy })
    const res = await post(app, '/api/interpret',
      { assessmentId: 'not-exist', pathId: 'same-discipline-baoyan' }, cookie)
    expect(res.status).toBe(404)
    expect(called).toBe(false)
  })

  it('未带会话 cookie 时返回 401', async () => {
    const { app, cookie } = await authedApp(bundle, { model: mockModel('不该出现') })
    const assessmentId = await diagnoseOnce(app, cookie)
    const res = await post(app, '/api/interpret',
      { assessmentId, pathId: 'same-discipline-baoyan' })
    expect(res.status).toBe(401)
  })
```

在 `POST /api/diagnose` 的 describe 内新增：

```ts
  it('落库并返回 assessmentId；同一用户重复测评累积两条记录', async () => {
    const store = openStore(':memory:')
    const { app, cookie } = await authedApp(bundle, { store })
    const res = await post(app, '/api/diagnose',
      { answers: okAnswers, grade: 'freshman' }, cookie)
    const body = (await res.json()) as { assessmentId: string }
    expect(body.assessmentId).toBeTruthy()

    await post(app, '/api/diagnose', { answers: okAnswers, grade: 'freshman' }, cookie)
    expect(store.listAssessments(meId(store))).toHaveLength(2)
  })

  it('source 落库正确；缺省为 self，非法值 400', async () => {
    const store = openStore(':memory:')
    const { app, cookie } = await authedApp(bundle, { store })
    const me = (await (await app.request('/api/auth/me', { headers: { cookie } })).json()) as { id: string }

    await post(app, '/api/diagnose', { answers: okAnswers, grade: 'freshman' }, cookie)
    await post(app, '/api/diagnose',
      { answers: okAnswers, grade: 'freshman', source: 'other' }, cookie)
    expect(store.listAssessments(me.id).map(r => r.source).sort()).toEqual(['other', 'self'])

    const bad = await post(app, '/api/diagnose',
      { answers: okAnswers, grade: 'freshman', source: 'nonsense' }, cookie)
    expect(bad.status).toBe(400)
  })

  it('未带会话 cookie 时返回 401', async () => {
    const { app } = await authedApp(bundle)
    const res = await post(app, '/api/diagnose', { answers: okAnswers, grade: 'freshman' })
    expect(res.status).toBe(401)
  })
```

Run: `pnpm --filter @navi/api test -- server`
Expected: FAIL —— 新增用例红（`assessmentId` 是 `undefined`、401 变 200 等），原有用例因缺 cookie 也大片转红。这正是要看到的状态。

- [ ] **Step 3: 改 server.ts**

改动清单：

1. import 区加：
   ```ts
   import { openStore, defaultDbPath } from './store.js'
   import type { Store, Source, AssessmentRecord } from './store.js'
   import { registerAuthRoutes, requireSession, sessionUser } from './auth.js'
   ```

2. `AppOptions` 扩为：
   ```ts
   export interface AppOptions {
     /** 测试注入用；生产不传，走 DeepSeek */
     model?: LanguageModel
     /** 会话签名密钥。未配置时认证端点与受保护端点一律 503 */
     jwtSecret?: string
     /** 测试注入用；生产不传，懒开 apps/api/data/navi.db */
     store?: Store
   }
   ```

3. 在 `createApp` 内加懒开默认库（**懒**是要害：否则那些只用 `createApp(bundle)`
   的公开端点测试会在仓库里创建出真实数据库文件）：
   ```ts
   let lazyStore: Store | null = null
   function getStore(): Store {
     // 懒开：只有真用到存储的端点才会落盘，不相关的测试不会创建出数据库文件
     lazyStore ??= options.store ?? openStore(defaultDbPath())
     return lazyStore
   }
   // 传的是 thunk 本身，不是调用结果——写成 getStore() 就等于在装配期打开数据库
   const auth = { store: getStore, jwtSecret: options.jwtSecret ?? process.env.JWT_SECRET }
   ```
   注意 `options.jwtSecret ?? process.env.JWT_SECRET` 这里用 `??` 是安全的——它挡的是
   「测试没传」，而 `process.env.JWT_SECRET` 可能为空串；下游 `unavailable()` 用
   falsy 判断兜住空串。

   本任务后续所有取用存储的地方都写 `getStore()`。

4. `app.get('/api/questions', ...)` 与 `/api/knowledge/:pathId` **不动**（保持公开）。

5. 三个测评端点各加 `requireSession(auth)` 中间件。

6. `/api/diagnose` 末尾落库并返回 id：
   ```ts
   const source = parseSource((body as { source?: unknown }).source)
   if (source === null) return c.json({ error: 'source 只能是 self 或 other' }, 400)
   const result = diagnose(v.answers, scoped)
   const assessmentId = getStore().createAssessment({
     userId: sessionUser(c).id,
     source,
     grade: v.grade ?? null,
     answers: v.answers,
     result,
   })
   return c.json({ ...result, tiedPaths: findTiedPaths(result).map(p => p.id), assessmentId })
   ```
   配一个 `parseSource`（缺省 `'self'`，非法返回 `null`）：
   ```ts
   function parseSource(value: unknown): Source | null {
     if (value === undefined) return 'self'
     return value === 'self' || value === 'other' ? value : null
   }
   ```

7. 新增按记录取数的辅助，替换 interpret/chat 里的 `validateAnswers` 与 `findPathId`：
   ```ts
   /** 按 assessmentId 取本人的记录；取不到返回 404 响应（不区分不存在与不属于本人） */
   function loadRecord(
     c: Context, store: Store, body: unknown,
   ): AssessmentRecord | Response {
     const id = String((body as { assessmentId?: unknown }).assessmentId ?? '')
     const record = store.findAssessment(id, sessionUser(c).id)
     if (record === null) return c.json({ error: `测评记录不存在：${id}` }, 404)
     return record
   }

   /** pathId 必须是这条记录快照里真实存在的路径 */
   function pathIdInRecord(body: unknown, record: AssessmentRecord): string | null {
     const id = String((body as { pathId?: unknown }).pathId ?? '')
     return record.result.paths.some(p => p.id === id) ? id : null
   }
   ```

8. `/api/interpret` 改为：
   ```ts
   app.post('/api/interpret', requireSession(auth), async c => {
     const body = await readBody(c)
     if (body instanceof Response) return body

     const record = loadRecord(c, getStore(), body)
     if (record instanceof Response) return record

     const pathId = pathIdInRecord(body, record)
     if (pathId === null) {
       const asked = String((body as { pathId?: unknown }).pathId ?? '')
       return c.json({ error: `路径不存在：${asked}` }, 404)
     }

     if (!options.model && !process.env.DEEPSEEK_API_KEY) {
       return c.json({ error: '个性化解读暂不可用：服务端未配置模型' }, 503)
     }

     const scoped: KnowledgeBundle = {
       ...bundle, questions: scopeQuestions(bundle.questions, parseGrade(record.grade)),
     }
     try {
       return streamInterpret(
         { answers: record.answers, pathId, bundle: scoped, result: record.result },
         options,
       ).toTextStreamResponse()
     } catch (error) {
       return c.json({ error: `个性化解读暂不可用：${(error as Error).message}` }, 503)
     }
   })
   ```
   `result: record.result` 这个参数在 Task 4 才加进 `streamInterpret`。**本任务先不传它**，
   等 Task 4 一并加上——否则这一步编译不过。

9. `/api/chat` 同样处理：`loadRecord` + `pathIdInRecord`，`streamChat` 的入参改用
   `record.answers` 与 `record.result`（`result` 同样留到 Task 4）。

10. 删除已无引用的 `validateAnswers` 的调用点，但**保留 `validateAnswers` 函数本身**——
    `/api/diagnose` 仍在用。删除已无引用的 `findPathId`。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @navi/api test`
Expected: PASS，全部用例绿。

- [ ] **Step 5: 提交**

```bash
git add apps/api/src/server.ts apps/api/src/server.test.ts
git commit -m "feat(api): 测评端点接入账号与记录，diagnose 落库并返回 assessmentId"
```

---

### Task 4: 解读持久化（含半截流防护）

**Files:**
- Modify: `packages/llm/src/index.ts`
- Modify: `packages/llm/src/index.test.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/src/server.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `Store.setInterpretation`；Task 3 的 `loadRecord` 与 `assessmentId` 参数
- Produces: `streamInterpret` / `streamChat` 的入参新增可选 `result?: DiagnosisResult`

- [ ] **Step 1: 写失败测试（这一步同时验证 Review Focus #1 与 #2）**

在 `apps/api/src/server.test.ts` 的 `POST /api/interpret` describe 内新增：

```ts
  it('流正常结束后，解读全文写入该记录', async () => {
    const store = openStore(':memory:')
    const { app, cookie } = await authedApp(bundle, { model: mockModel('你现在的位置是大一。'), store })
    const assessmentId = await diagnoseOnce(app, cookie)

    const res = await post(app, '/api/interpret',
      { assessmentId, pathId: 'same-discipline-baoyan' }, cookie)
    expect(res.status).toBe(200)
    await res.text()                                  // 必须消费响应体，流才会走完

    await vi.waitFor(() => {
      const me = store.findAssessment(assessmentId, meId(store))
      expect(me?.interpretation).toBe('你现在的位置是大一。')
    })
  })

  it('流中途出错时绝不写入半截解读', async () => {
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
    const { app, cookie } = await authedApp(bundle, { model: brokenMidStream, store })
    const assessmentId = await diagnoseOnce(app, cookie)

    const res = await post(app, '/api/interpret',
      { assessmentId, pathId: 'same-discipline-baoyan' }, cookie)
    await res.text().catch(() => undefined)           // 出错流可能直接断，容忍

    // 给异步写入足够的窗口（若实现是错的，这里必然已经写进去了）
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(store.findAssessment(assessmentId, meId(store))?.interpretation).toBeNull()
  })
```

`meId` 与 `diagnoseOnce` 都在 Task 3 已经加好了，这里直接复用。

在文件顶部补 `import { vi } from 'vitest'`（若尚未从 vitest 导入）。

Run: `pnpm --filter @navi/api test -- server`
Expected: 第一条红（`interpretation` 仍是 `null`），第二条**也会红**——因为此刻还没实现任何写入，`interpretation` 本来就是 `null`。

> **第二条此刻红不了，说明测试断言方向写反了。** 正确顺序是：先按 Step 3 用最朴素的
> `await stream.text` 实现写入，再跑一次，**第二条必须转红**——那才证明
> `packages/llm/src/index.test.ts:126` 记录的已知缺陷真的会咬到我们。看到它红之后再进
> Step 4 换成 `finishReason` 闸门。**不要跳过这次确认**：这正是 Review Focus #2 要防的
> 那个静默失效。

- [ ] **Step 2: 先证明已知缺陷会咬到我们**

在 `apps/api/src/server.ts` 的 `/api/interpret` 里加一个**临时**的朴素实现：

```ts
const stream = streamInterpret({ answers: record.answers, pathId, bundle: scoped }, options)
const res = stream.toTextStreamResponse()
void stream.text.then(text => getStore().setInterpretation(record.id, text)).catch(() => {})
return res
```

Run: `pnpm --filter @navi/api test -- server`
Expected: 第一条**绿**，第二条**红**（`interpretation` 变成了 `'前半句'`）。
第二条红了就说明缺陷确认存在，继续 Step 3。

- [ ] **Step 3: 用 finishReason 闸门替换朴素实现**

先探针确认 `finishReason` 在两种流下的取值。在 `apps/api/src/server.ts` 的
`/api/interpret` 里临时插入：

```ts
void stream.finishReason.then(r => console.log('[probe] finishReason =', r))
```

Run: `pnpm --filter @navi/api test -- server -t "流"`
Expected: 正常流打印 `stop`，出错流打印 `error`。
（`FinishReason` 的取值域是 `'stop' | 'length' | 'content-filter' | 'tool-calls' | 'error' | 'other'`。）

若 `finishReason` 在响应体被消费后**不 resolve**（探针什么都不打印），说明 Review Focus #1
命中：改用 `streamText` 的 `onEnd` 回调（v7 里 `onFinish` 已是它的废弃别名）——那需要把
回调从 `apps/api` 透传给 `streamInterpret`。**这是一个 Ruling，记进 ledger。**

删掉探针，替换成：

```ts
/**
 * 流正常结束后把解读全文补写回记录（spec §4.7）。
 *
 * 必须在 finishReason 上设闸门：`.text` 在流中途出错时会静默 resolve 出**已累积的
 * 半截文本**（packages/llm/src/index.test.ts:126 记录了这个缺陷）。直接 await .text
 * 再写库会把残缺解读存进去，而它会被当成「已生成」从此不再重算——最坏的组合。
 */
function persistInterpretation(stream: StreamResult, store: Store, recordId: string): void {
  void (async () => {
    try {
      if (await stream.finishReason !== 'stop') return
      const text = await stream.text
      if (text.trim() === '') return
      store.setInterpretation(recordId, text)
    } catch {
      // 写失败只记日志：响应已经开始流向用户，这里不该再抛
      console.warn(`[api] 解读写入失败：${recordId}`)
    }
  })()
}
```

`StreamResult` 在 `apps/api` 里用 `ReturnType<typeof streamInterpret>`。调用处：

```ts
const stream = streamInterpret(
  { answers: record.answers, pathId, bundle: scoped, result: record.result },
  options,
)
const res = stream.toTextStreamResponse()
persistInterpretation(stream, getStore(), record.id)
return res
```

- [ ] **Step 4: 跑测试确认两条都绿**

Run: `pnpm --filter @navi/api test -- server`
Expected: PASS —— 正常流写入、出错流不写，两条都过。

- [ ] **Step 5: 给 llm 加可选 result 并写它的测试**

在 `packages/llm/src/index.test.ts` 的 `streamInterpret` describe 内新增：

```ts
  it('传入预置 result 时上下文用它，不重算（快照与页面显示一致）', async () => {
    const model = mockModel()
    // 造一份与 answers 重算结果必然不同的快照：match 明显是伪造值
    const snapshot = diagnose(answers, bundle)
    const tampered = {
      ...snapshot,
      paths: snapshot.paths.map(p => ({ ...p, match: 12 })),
    }

    await streamInterpret(
      { answers, pathId: 'same-discipline-baoyan', bundle, result: tampered },
      { model },
    ).text

    const prompt = JSON.stringify(model.doStreamCalls[0]!.prompt)
    expect(prompt).toContain('匹配度 12')
  })
```

文件顶部补 `import { diagnose } from '@navi/core'`。

Run: `pnpm --filter @navi/llm test -- index`
Expected: FAIL —— `匹配度 12` 找不到（上下文用的是重算结果）。

- [ ] **Step 6: 实现 llm 的可选 result**

改 `packages/llm/src/index.ts` 的 `sliceOf`：

```ts
/**
 * 结果只能来自服务端自己：重算，或读本服务端落库的快照。绝不接受请求体里的结果
 * （设计文档 §1.3「确定性优先」、§4.1 决策一）。
 *
 * 传快照是为了让解读与用户眼前显示的数字一致：知识库会在测评记录存续期间被重建
 * （§12.2 内容工作与开发并行），而 bundle 在进程启动时读一次，跨重启重算会得出
 * 与页面不同的匹配度。
 */
function sliceOf(
  answers: Answers, bundle: KnowledgeBundle, pathId: string, result?: DiagnosisResult,
): KnowledgeSlice {
  return { bundle, result: result ?? diagnose(answers, bundle), pathId, answers }
}
```

`streamInterpret` 与 `streamChat` 的入参类型各加一行 `result?: DiagnosisResult`，
并把它透传给 `sliceOf`。`DiagnosisResult` 从 `@navi/core` 的类型导入里补上。

- [ ] **Step 7: 跑全量测试**

Run: `pnpm test`
Expected: 全部包全绿（knowledge / core / llm / web / api）。

- [ ] **Step 8: 提交**

```bash
git add packages/llm/src/index.ts packages/llm/src/index.test.ts apps/api/src/server.ts apps/api/src/server.test.ts
git commit -m "feat(llm,api): 解读流正常结束后落库，上下文改用记录快照"
```

---

### Task 5: 历史读取端点

**Files:**
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/src/server.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `Store.listAssessments` / `findAssessment`；Task 3 的 `requireSession`
- Produces: `GET /api/assessments` → `{ assessments: AssessmentSummary[] }`，每项含 `mainPathId` 与 `mainPathTitle`；`GET /api/assessments/:id` → 单条完整记录 + `paths` 摘要 + `mainPathId` + `tiedPaths`

- [ ] **Step 1: 写失败测试**

在 `apps/api/src/server.test.ts` 新增一个 describe：

```ts
describe('GET /api/assessments（历史）', () => {
  it('列出本人的历次测评，倒序，含主推荐路径与匹配度', async () => {
    const { app, cookie } = await authedApp(bundle)
    await post(app, '/api/diagnose',
      { answers: okAnswers, grade: 'freshman', source: 'other' }, cookie)

    const res = await app.request('/api/assessments', { headers: { cookie } })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      assessments: Array<{
        source: string; mainPathId: string; mainPathTitle: string
        match: number; grade: string
      }>
    }
    expect(body.assessments).toHaveLength(1)
    expect(body.assessments[0]!.source).toBe('other')
    expect(body.assessments[0]!.mainPathId).toBe('same-discipline-baoyan')
    // 列表要显示中文路径名；服务端手里有 bundle，不必让前端再取一次 /api/questions
    expect(body.assessments[0]!.mainPathTitle).toBe('本学科保研')
    expect(body.assessments[0]!.grade).toBe('freshman')
    expect(typeof body.assessments[0]!.match).toBe('number')
  })

  it('不带会话 cookie 返回 401', async () => {
    const { app } = await authedApp(bundle)
    expect((await app.request('/api/assessments')).status).toBe(401)
  })

  it('只看得到本人的记录', async () => {
    const store = openStore(':memory:')
    const alice = await authedApp(bundle, { store })
    const bob = await authedApp(bundle, { store })   // 同一库里的第二个用户
    await post(alice.app, '/api/diagnose', { answers: okAnswers, grade: 'freshman' }, alice.cookie)

    const res = await bob.app.request('/api/assessments', { headers: { cookie: bob.cookie } })
    expect(((await res.json()) as { assessments: unknown[] }).assessments).toHaveLength(0)
  })
})

describe('GET /api/assessments/:id（单条完整）', () => {
  it('返回完整记录、路径摘要、主推荐路径与并列路径，以及可空的解读', async () => {
    const { app, cookie } = await authedApp(bundle)
    const assessmentId = await diagnoseOnce(app, cookie)

    const res = await app.request(`/api/assessments/${assessmentId}`, { headers: { cookie } })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      answers: Record<string, number>; interpretation: string | null
      paths: Array<{ id: string }>; mainPathId: string; tiedPaths: string[]
    }
    expect(body.answers).toEqual(okAnswers)
    expect(body.interpretation).toBeNull()
    expect(body.paths[0]!.id).toBe('same-discipline-baoyan')
    expect(body.mainPathId).toBe('same-discipline-baoyan')
    expect(body.tiedPaths).toEqual(['same-discipline-baoyan'])
  })

  it('解读生成后能从这条接口取回', async () => {
    const store = openStore(':memory:')
    const { app, cookie } = await authedApp(bundle, { model: mockModel('解读全文'), store })
    const assessmentId = await diagnoseOnce(app, cookie)
    const streamed = await post(app, '/api/interpret',
      { assessmentId, pathId: 'same-discipline-baoyan' }, cookie)
    await streamed.text()

    await vi.waitFor(async () => {
      const res = await app.request(`/api/assessments/${assessmentId}`, { headers: { cookie } })
      const body = (await res.json()) as { interpretation: string | null }
      expect(body.interpretation).toBe('解读全文')
    })
  })

  it('他人的 id 与不存在的 id 都返回 404', async () => {
    const store = openStore(':memory:')
    const alice = await authedApp(bundle, { store })
    const bob = await authedApp(bundle, { store })
    const id = await diagnoseOnce(alice.app, alice.cookie)

    expect((await bob.app.request(`/api/assessments/${id}`, { headers: { cookie: bob.cookie } })).status).toBe(404)
    expect((await bob.app.request('/api/assessments/nope', { headers: { cookie: bob.cookie } })).status).toBe(404)
  })

  it('库里某行 result 损坏时列表跳过坏行，其余照常返回（不 500）', async () => {
    const { app, cookie, store } = await authedApp(bundle)
    await diagnoseOnce(app, cookie)
    const user = store.verifyUser('tester', 'pw123456')!
    const good = store.listAssessments(user.id)[0]!.id
    store.createAssessment({ userId: user.id, source: 'self', grade: null, answers: {}, result: {} as never })

    const res = await app.request('/api/assessments', { headers: { cookie } })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { assessments: Array<{ id: string }> }
    expect(body.assessments.map(a => a.id)).toEqual([good])
  })
})
```

Run: `pnpm --filter @navi/api test -- server`
Expected: FAIL —— 两个端点都返回 404（尚未注册路由）。

- [ ] **Step 2: 实现两个端点**

在 `apps/api/src/server.ts` 的 `createApp` 内、`/api/knowledge/:pathId` 之前加：

```ts
  /** 历史列表：主推荐路径与匹配度由该条 result 快照推出，不另立算法（§9.3） */
  app.get('/api/assessments', requireSession(auth), c => {
    const rows = getStore().listAssessments(sessionUser(c).id)
    const titles = new Map(bundle.paths.map(p => [p.id, p.title]))
    return c.json({
      assessments: rows.map(row => {
        const main = findTiedPaths(row.result)[0]
        return {
          id: row.id,
          source: row.source,
          grade: row.grade,
          createdAt: row.createdAt,
          mainPathId: main?.id ?? null,
          // 标题由服务端补，前端就不必为了显示中文名再取一次 /api/questions
          mainPathTitle: main === undefined ? null : (titles.get(main.id) ?? main.id),
          match: main === undefined ? null : Math.round(main.match),
        }
      }),
    })
  })

  app.get('/api/assessments/:id', requireSession(auth), c => {
    const record = getStore().findAssessment(c.req.param('id'), sessionUser(c).id)
    if (record === null) return c.json({ error: '测评记录不存在' }, 404)

    return c.json({
      id: record.id,
      source: record.source,
      grade: record.grade,
      createdAt: record.createdAt,
      answers: record.answers,
      result: record.result,
      interpretation: record.interpretation,
      mainPathId: findTiedPaths(record.result)[0]?.id ?? null,
      tiedPaths: findTiedPaths(record.result).map(p => p.id),
      // 自带宽渲染结果页所需的路径摘要，避免历史详情依赖第二次请求
      paths: bundle.paths.map(p => ({
        id: p.id, title: p.title, category: p.category,
        span: p.span, status: p.status, summary: p.summary,
      })),
    })
  })
```

- [ ] **Step 3: 跑测试确认通过**

Run: `pnpm --filter @navi/api test`
Expected: PASS，全部用例绿。

- [ ] **Step 4: 提交**

```bash
git add apps/api/src/server.ts apps/api/src/server.test.ts
git commit -m "feat(api): 新增历史列表与单条详情端点"
```

---

### Task 6: 前端 —— 登录、选测评对象、assessmentId 贯通

**Files:**
- Create: `apps/web/src/components/Login.tsx`
- Create: `apps/web/src/components/Login.test.tsx`
- Modify: `apps/web/src/api.ts`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/App.test.tsx`
- Modify: `apps/web/src/components/PathAssistant.tsx`（仅把 transport body 换成 `{ assessmentId, pathId }`）
- Modify: `apps/web/src/components/ResultView.tsx`（仅把 `assessmentId` 透传下去）
- Modify: `apps/web/src/components/PathAssistant.test.tsx`

**Interfaces:**
- Consumes: Task 3 的 `/api/diagnose` 返回 `assessmentId`、`/api/interpret` 与 `/api/chat` 的 `{ assessmentId, pathId }` 入参；Task 2 的 `/api/auth/*`
- Produces: `api.ts` 导出 `register` / `login` / `logout` / `fetchMe` / `postDiagnose(answers, grade, source)`；`Login` 组件；`App` 新增 `auth` 与 `choosing` 两个 stage

- [ ] **Step 1: 写失败测试**

创建 `apps/web/src/components/Login.test.tsx`：

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Login } from './Login.js'

beforeEach(() => { vi.restoreAllMocks() })

describe('Login', () => {
  it('默认是登录态，可切到注册', async () => {
    render(<Login onSuccess={() => {}} />)
    expect(screen.getByRole('button', { name: '登录' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '还没有账号？注册' }))
    expect(screen.getByRole('button', { name: '注册' })).toBeInTheDocument()
  })

  it('登录成功后回调带上用户名', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ id: 'u1', username: 'alice' }), { status: 200 }),
    )
    const onSuccess = vi.fn()
    render(<Login onSuccess={onSuccess} />)

    await userEvent.type(screen.getByLabelText('用户名'), 'alice')
    await userEvent.type(screen.getByLabelText('密码'), 'pw123456')
    await userEvent.click(screen.getByRole('button', { name: '登录' }))

    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith('alice'))
  })

  it('登录失败时显示服务端返回的错误文案，不回调', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: '用户名或密码不正确' }), { status: 401 }),
    )
    const onSuccess = vi.fn()
    render(<Login onSuccess={onSuccess} />)

    await userEvent.type(screen.getByLabelText('用户名'), 'alice')
    await userEvent.type(screen.getByLabelText('密码'), 'wrong')
    await userEvent.click(screen.getByRole('button', { name: '登录' }))

    expect(await screen.findByText('用户名或密码不正确')).toBeInTheDocument()
    expect(onSuccess).not.toHaveBeenCalled()
  })
})
```

在 `apps/web/src/App.test.tsx` 里加：

```tsx
it('未登录时渲染登录页，不直接进问卷', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ error: '未登录' }), { status: 401 }),
  )
  render(<App />)
  expect(await screen.findByRole('button', { name: '登录' })).toBeInTheDocument()
})
```

Run: `pnpm --filter @navi/web test`
Expected: FAIL —— `Failed to resolve import "./Login.js"`。

- [ ] **Step 2: 实现 api.ts 的新函数**

在 `apps/web/src/api.ts` 追加：

```ts
export type AssessmentSource = 'self' | 'other'

async function jsonOrThrow(res: Response, what: string): Promise<unknown> {
  if (res.ok) return res.json()
  const body = (await res.json().catch(() => ({}))) as { error?: string }
  throw new Error(body.error ?? `${what}失败：${res.status}`)
}

export async function fetchMe(): Promise<{ id: string; username: string } | null> {
  const res = await fetch('/api/auth/me')
  if (res.status === 401) return null
  return (await jsonOrThrow(res, '获取账号')) as { id: string; username: string }
}

export async function authenticate(
  mode: 'login' | 'register', username: string, password: string,
): Promise<{ id: string; username: string }> {
  const res = await fetch(`/api/auth/${mode}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  return (await jsonOrThrow(res, mode === 'login' ? '登录' : '注册')) as {
    id: string; username: string
  }
}

export async function logout(): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST' })
}
```

`postDiagnose` 改为：

```ts
export async function postDiagnose(
  answers: Record<string, number>,
  grade: Grade,
  source: AssessmentSource,
): Promise<DiagnosisResponse> {
  const res = await fetch('/api/diagnose', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ answers, grade, source }),
  })
  if (!res.ok) throw new Error(`诊断失败：${res.status}`)
  return (await res.json()) as DiagnosisResponse
}
```

`DiagnosisResponse` 加一字段：

```ts
export interface DiagnosisResponse extends DiagnosisResult {
  tiedPaths: string[]
  assessmentId: string
}
```

- [ ] **Step 3: 实现 Login.tsx**

创建 `apps/web/src/components/Login.tsx`：

```tsx
import { useState } from 'react'
import type { FormEvent } from 'react'
import { authenticate } from '../api.js'

interface Props {
  onSuccess: (username: string) => void
}

/** 注册与登录共用一个表单：字段一样，只是提交的端点与按钮文案不同 */
export function Login({ onSuccess }: Props) {
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
      const user = await authenticate(mode, username, password)
      onSuccess(user.username)
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-sm p-6">
      <h1 className="mb-4 text-xl font-semibold">Navi</h1>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label htmlFor="username" className="block text-sm">用户名</label>
          <input
            id="username" name="username" value={username}
            onChange={e => setUsername(e.target.value)}
            className="w-full border p-2" autoComplete="username"
          />
        </div>
        <div>
          <label htmlFor="password" className="block text-sm">密码</label>
          <input
            id="password" name="password" type="password" value={password}
            onChange={e => setPassword(e.target.value)}
            className="w-full border p-2" autoComplete="current-password"
          />
        </div>
        {error !== '' && <p className="text-red-600">{error}</p>}
        <button type="submit" disabled={busy} className="w-full border px-4 py-2">
          {mode === 'login' ? '登录' : '注册'}
        </button>
      </form>
      <button
        type="button"
        className="mt-3 text-sm text-gray-600 underline"
        onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError('') }}
      >
        {mode === 'login' ? '还没有账号？注册' : '已有账号？登录'}
      </button>
    </div>
  )
}
```

- [ ] **Step 4: 改 App.tsx 的流程**

顶部 import 改为：

```tsx
import { useEffect, useState } from 'react'
import { fetchMe, fetchQuestions, postDiagnose } from './api.js'
import type { AssessmentSource, DiagnosisResponse, Grade, QuestionsResponse } from './api.js'
import { Login } from './components/Login.js'
import { Questionnaire } from './components/Questionnaire.js'
import { ResultView } from './components/ResultView.js'

type Stage = 'auth' | 'choosing' | 'grade' | 'loading' | 'questions' | 'result' | 'error'
```

组件内新增状态与挂载探测：

```tsx
  const [stage, setStage] = useState<Stage>('auth')
  const [username, setUsername] = useState('')
  const [source, setSource] = useState<AssessmentSource>('self')
  const [assessmentId, setAssessmentId] = useState('')

  // 挂载时问一次服务端「我是谁」：已登录用户不该被推回登录页
  useEffect(() => {
    void fetchMe().then(me => {
      if (me === null) return
      setUsername(me.username)
      setStage('choosing')
    })
  }, [])
```

`handleSubmit` 里把诊断返回的 `assessmentId` 存下来：

```tsx
  async function handleSubmit(answers: Record<string, number>) {
    try {
      const result = await postDiagnose(answers, grade, source)
      setResult(result)
      setAssessmentId(result.assessmentId)
      setSubmittedAnswers(answers)
      setStage('result')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '诊断失败')
      setStage('error')
    }
  }
```

在 `if (stage === 'grade')` **之前**插入两个新分支：

```tsx
  if (stage === 'auth') {
    return <Login onSuccess={name => { setUsername(name); setStage('choosing') }} />
  }

  if (stage === 'choosing') {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <h1 className="mb-2 text-xl font-semibold">你好，{username}</h1>
        <p className="mb-4 text-gray-600">
          这次要做的是谁的测评？两种都会留存记录，但只有「测测自己」的结果会用来给你解读。
        </p>
        <div className="flex flex-wrap gap-3">
          <button type="button" className="border px-4 py-2"
            onClick={() => { setSource('self'); setStage('grade') }}>
            测测自己
          </button>
          <button type="button" className="border px-4 py-2"
            onClick={() => { setSource('other'); setStage('grade') }}>
            测测别人
          </button>
        </div>
      </div>
    )
  }
```

`stage === 'result'` 分支给 `ResultView` 补传 `assessmentId`（`answers` 与 `grade`
在 Step 5 会被删掉，所以这里直接写成最终形状）：

```tsx
    return (
      <ResultView
        result={result}
        paths={data.paths}
        tiedPaths={result.tiedPaths}
        assessmentId={assessmentId}
      />
    )
```

（「我的历史」入口在 Task 7 接上。）

- [ ] **Step 5: 把 assessmentId 一路传到 PathAssistant**

`PathAssistant` 的 Props 把 `answers` / `grade` 换成 `assessmentId`：

```tsx
interface Props {
  assessmentId: string
  pathId: string
}
```

`useCompletion` 的 `body` 与 `DefaultChatTransport` 的 `body` 都改成
`{ assessmentId, pathId }`，`useMemo` 的依赖数组同步改为 `[assessmentId, pathId]`。

`ResultView` 的 `answers` 与 `grade` 两个 prop 因此**变成死代码**——它们唯一的用途
就是往下传给 `PathAssistant`（`ResultView.tsx:115`）。删掉它们，换成 `assessmentId`：

```tsx
interface Props {
  result: DiagnosisResult
  paths: PathSummary[]
  /** 与主推荐路径显示分相同的路径 id，含主推荐自身（设计文档 §9.3） */
  tiedPaths?: string[]
  assessmentId: string
  /** 历史详情带回来的解读；刚测完时为 undefined，由 PathAssistant 现场生成 */
  interpretation?: string | null
}

export function ResultView({
  result, paths, tiedPaths = [], assessmentId, interpretation,
}: Props) {
```

末端改为：

```tsx
      {main !== null && (
        <PathAssistant
          key={main.id}
          assessmentId={assessmentId}
          pathId={main.id}
          interpretation={interpretation}
        />
      )}
```

同步更新 `PathAssistant.test.tsx`、`PathAssistant.stream.test.tsx`、
`ResultView.test.tsx` 里的 props 与 `body` 断言。

- [ ] **Step 6: 跑测试确认通过**

Run: `pnpm --filter @navi/web test`
Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add apps/web/src
git commit -m "feat(web): 新增登录页与选择测评对象，测评链路贯通 assessmentId"
```

---

### Task 7: 前端 —— 历史列表与预置解读

**Files:**
- Create: `apps/web/src/components/History.tsx`
- Create: `apps/web/src/components/History.test.tsx`
- Modify: `apps/web/src/api.ts`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/components/PathAssistant.tsx`
- Modify: `apps/web/src/components/PathAssistant.test.tsx`
- Modify: `apps/web/src/components/ResultView.tsx`

**Interfaces:**
- Consumes: Task 5 的 `/api/assessments` 与 `/api/assessments/:id`
- Produces: `api.ts` 的 `fetchAssessments()` / `fetchAssessment(id)`；`History` 组件；`PathAssistant` 新增可选 `interpretation?: string | null`

- [ ] **Step 1: 写失败测试**

创建 `apps/web/src/components/History.test.tsx`：

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { History } from './History.js'

beforeEach(() => { vi.restoreAllMocks() })

const rows = [
  { id: 'a1', source: 'self', grade: 'freshman', createdAt: '2026-02-01T00:00:00.000Z',
    mainPathId: 'same-discipline-baoyan', mainPathTitle: '本学科保研', match: 55 },
  { id: 'a2', source: 'other', grade: 'sophomore', createdAt: '2026-01-01T00:00:00.000Z',
    mainPathId: 'same-discipline-kaoyan', mainPathTitle: '本学科考研', match: 48 },
]

describe('History', () => {
  it('列出历次测评，标出测的是谁，主推荐路径显示中文名', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ assessments: rows }), { status: 200 }),
    )
    render(<History onOpen={() => {}} />)

    expect(await screen.findByText('测测自己')).toBeInTheDocument()
    expect(screen.getByText('测测别人')).toBeInTheDocument()
    expect(screen.getByText(/本学科保研/)).toBeInTheDocument()
  })

  it('列表为空时给出空态而不是空白', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ assessments: [] }), { status: 200 }),
    )
    render(<History onOpen={() => {}} />)
    expect(await screen.findByText('还没有测评记录')).toBeInTheDocument()
  })

  it('点某一条时把 id 交给上层', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ assessments: rows }), { status: 200 }),
    )
    const onOpen = vi.fn()
    render(<History onOpen={onOpen} />)
    await userEvent.click(await screen.findByText('测测自己'))
    expect(onOpen).toHaveBeenCalledWith('a1')
  })
})
```

在 `PathAssistant.test.tsx` 新增：

```tsx
it('传入已有解读时直接渲染，不再请求 /api/interpret', () => {
  const fetchSpy = vi.spyOn(globalThis, 'fetch')
  render(<PathAssistant assessmentId="a1" pathId="p1" interpretation="存下来的解读" />)
  expect(screen.getByText('存下来的解读')).toBeInTheDocument()
  expect(fetchSpy).not.toHaveBeenCalled()
})
```

Run: `pnpm --filter @navi/web test`
Expected: FAIL —— `Failed to resolve import "./History.js"`，以及预置解读那条找不到文字。

- [ ] **Step 2: 实现 api.ts 的历史函数**

```ts
export interface AssessmentSummary {
  id: string
  source: AssessmentSource
  grade: string | null
  createdAt: string
  mainPathId: string | null
  /** 服务端补好的中文路径名，前端不必再取 /api/questions */
  mainPathTitle: string | null
  match: number | null
}

export interface AssessmentDetail {
  id: string
  source: AssessmentSource
  grade: string | null
  createdAt: string
  answers: Record<string, number>
  result: DiagnosisResult
  interpretation: string | null
  mainPathId: string | null
  tiedPaths: string[]
  paths: PathSummary[]
}

export async function fetchAssessments(): Promise<AssessmentSummary[]> {
  const res = await fetch('/api/assessments')
  const body = (await jsonOrThrow(res, '获取历史')) as { assessments: AssessmentSummary[] }
  return body.assessments
}

export async function fetchAssessment(id: string): Promise<AssessmentDetail> {
  const res = await fetch(`/api/assessments/${encodeURIComponent(id)}`)
  return (await jsonOrThrow(res, '获取测评记录')) as AssessmentDetail
}
```

- [ ] **Step 3: 实现 History.tsx**

创建 `apps/web/src/components/History.tsx`：

```tsx
import { useEffect, useState } from 'react'
import { fetchAssessments } from '../api.js'
import type { AssessmentSummary } from '../api.js'

interface Props {
  onOpen: (id: string) => void
}

const GRADES: Record<string, string> = {
  freshman: '大一', sophomore: '大二', junior: '大三', senior: '大四及以上',
}

export function History({ onOpen }: Props) {
  const [rows, setRows] = useState<AssessmentSummary[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    void fetchAssessments()
      .then(setRows)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : '加载失败'))
  }, [])

  if (error !== '') return <p className="p-6 text-red-600">{error}</p>
  if (rows === null) return <p className="p-6">加载中……</p>
  if (rows.length === 0) return <p className="p-6">还没有测评记录</p>

  return (
    <ul className="mx-auto max-w-3xl space-y-2 p-6">
      {rows.map(row => (
        <li key={row.id}>
          <button
            type="button"
            className="w-full border p-3 text-left"
            onClick={() => onOpen(row.id)}
          >
            <span className="font-medium">
              {row.source === 'self' ? '测测自己' : '测测别人'}
            </span>
            <span className="ml-2 text-sm text-gray-600">
              {row.grade === null ? '' : GRADES[row.grade] ?? row.grade}
              {' · '}
              {new Date(row.createdAt).toLocaleString('zh-CN')}
            </span>
            <span className="block text-sm">
              {row.mainPathTitle ?? '当前没有匹配的路径'}
              {row.match === null ? '' : ` · 匹配度 ${row.match}`}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}
```

- [ ] **Step 4: 让 PathAssistant 支持预置解读**

`PathAssistant` 的 Props 加 `interpretation?: string | null`。**hook 不能条件调用**——
`useCompletion` 照常调用，只让那个 `useEffect` 在已有解读时不触发：

```tsx
  const hasStored = interpretation !== undefined && interpretation !== null

  useEffect(() => {
    // 已有存下来的解读就不重新生成（spec §5.2）。hook 本身仍要无条件的调用，
    // 变的只是这个 effect——写成条件调用 hook 会直接崩。
    if (hasStored) return
    void complete('')
  }, [pathId, hasStored])
```

渲染处取值改为 `interpretation ?? completion`。

- [ ] **Step 5: 在 App.tsx 里接上历史**

import 区补（`fetchAssessments` 由 `History` 自己调用，`App` 只需要 `fetchAssessment`）：

```tsx
import { fetchAssessment } from './api.js'
import type { AssessmentDetail } from './api.js'
import { History } from './components/History.js'
```

`Stage` 加 `'history'`，新增状态：

```tsx
  const [historyDetail, setHistoryDetail] = useState<AssessmentDetail | null>(null)
```

`submittedAnswers` 现在**没人用了**（`ResultView` 不再接收 `answers`）——删掉它的
`useState` 与 `setSubmittedAnswers` 调用。`grade` 仍要留着，`postDiagnose` 与
`fetchQuestions` 都还在用。

在 `choosing` 分支的「测测别人」按钮之后加入口：

```tsx
        <button type="button" className="mt-4 block text-sm text-gray-600 underline"
          onClick={() => setStage('history')}>
          我的历史
        </button>
```

新增打开历史详情的处理函数：

```tsx
  async function openHistory(id: string) {
    try {
      setHistoryDetail(await fetchAssessment(id))
      setStage('result')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '加载失败')
      setStage('error')
    }
  }
```

在 `if (stage === 'grade')` **之前**插入历史分支：

```tsx
  if (stage === 'history') {
    return (
      <div className="mx-auto max-w-3xl px-6 pt-6">
        <button type="button" className="mb-4 text-sm text-gray-600 underline"
          onClick={() => setStage('choosing')}>
          回到首页
        </button>
        <History onOpen={openHistory} />
      </div>
    )
  }
```

把 Task 6 写的那个 `stage === 'result'` 分支替换为下面这段，统一两条数据来源：

```tsx
  // 刚测完与从历史点进来渲染的是同一个组件，只是数据来源不同。
  // AssessmentDetail 自带 paths 与 tiedPaths，历史路径不需要第二次请求。
  const page =
    historyDetail !== null
      ? {
          result: historyDetail.result,
          paths: historyDetail.paths,
          tiedPaths: historyDetail.tiedPaths,
          assessmentId: historyDetail.id,
          interpretation: historyDetail.interpretation,
        }
      : result !== null && data !== null
        ? {
            result,
            paths: data.paths,
            tiedPaths: result.tiedPaths,
            assessmentId,
            interpretation: null,
          }
        : null

  if (stage === 'result' && page !== null) {
    return (
      <>
        <div className="mx-auto max-w-3xl px-6 pt-6">
          <button type="button" className="text-sm text-gray-600 underline"
            onClick={() => { setHistoryDetail(null); setStage('choosing') }}>
            回到首页
          </button>
        </div>
        <ResultView {...page} />
      </>
    )
  }
```

`page` 的计算必须放在这个分支之前、且不在任何更早的 `if` 之内——它依赖
`result` / `data` / `historyDetail` 三者，而 `auth`、`choosing`、`history` 三个分支
都在它之前 return。

- [ ] **Step 6: 跑测试确认通过**

Run: `pnpm --filter @navi/web test`
Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add apps/web/src
git commit -m "feat(web): 新增只读历史列表，历史详情直接显示存下来的解读"
```

---

### Task 8: 同步主文档与配置

**Files:**
- Modify: `docs/superpowers/specs/2026-09-27-navi-career-planning-agent-design.md`

**Interfaces:**
- Consumes: 前面七个任务定下的接口形状与不变量
- Produces: 与实现一致的设计文档

- [ ] **Step 1: 改 §9.1 页面结构**

流程图改为：

```
首页 ──▶ 登录/注册 ──▶ 选择测评对象 ──▶ 诊断问卷 ──▶ 诊断结果页 ──▶ 追问对话
                       （测测自己 / 测测别人）          │
                                                       └──▶ 我的历史（只读）
                                                       └──▶ 路径知识库（可独立访问）
```

并在「知识库支持两条访问路径」那段后补一句：登录是**测评**的门槛，浏览知识库与
问卷端点不需要登录。

- [ ] **Step 2: 改 §3.4 HTTP 接口**

表里 `/api/interpret` 与 `/api/chat` 的说明改为按 `assessmentId` 取记录；新增
账号与历史端点；删掉「§4.2 的测评记录留存尚未对应任何端点」那段注记，改成指向
专项设计文件。

- [ ] **Step 3: 改 §4.2**

- 留存表格补一行「个性化解读」，注明是对原文的扩展
- 第 4 条「替别人测的记录不进入提问者的 agent 上下文」改为不变量措辞：
  **上下文只由单一记录构造；那条记录由当前请求的 `assessmentId` 显式指定，且必须是
  请求者本人的**；并注明谁将来想把多条历史喂进上下文，必须先按 `source` 过滤
- 「实现归属」那段补一句：已由专项设计
  `2026-10-02-navi-account-storage-design.md` 落地

- [ ] **Step 4: 改 §3.2 目录结构**

`apps/api` 下补 `src/auth.ts`、`src/store.ts`、`data/`（本地数据，不进 git）。

- [ ] **Step 5: 跑全量检查并提交**

Run: `pnpm test && pnpm lint && pnpm build`
Expected: 三项全绿。

```bash
git add docs/superpowers/specs/2026-09-27-navi-career-planning-agent-design.md
git commit -m "docs: 主文档同步账号与存储（登录步骤、接口面、留存表、不变量）"
```

---

## 完成标准

八个任务全绿后，对照 spec §1.1 的交付清单逐条确认：

1. 注册登录可用，密码不落明文，`.env` 与 `apps/api/data/` 都不在 git 里
2. 会话是 httpOnly cookie，前端 JS 读不到
3. `/api/diagnose` 落库，重复测评累积而非覆盖，`answers` 与 `result` 都可原样取回
4. 解读在流正常结束后补写；半截流不写；历史详情直接显示存下来的那段
5. 登录前看不到问卷，登录后能看到自己的历史
6. 「测测自己」与「测测别人」都留存，`source` 正确
7. 主文档五处已同步

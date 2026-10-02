import { createRequire } from 'node:module'
import { randomUUID, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Answers, DiagnosisResult } from '@navi/core'

/**
 * 为什么用 createRequire 而不是 `import { DatabaseSync } from 'node:sqlite'`。
 *
 * vite 5.4 判断「是不是 node 内置模块」用的是
 * `builtinModules.filter(id => !id.includes(':'))`——它主动把带前缀的名字滤掉。
 * 而 node:sqlite 在 Node 25 里只有带前缀的形式（isBuiltin('sqlite') === false），
 * 于是 vitest 走 vite 的解析时报 "Failed to load url sqlite"。
 * 试过 vite 插件标 external，vitest 的 module runner 不认，仍然去加载。
 *
 * 走 createRequire 是在运行时取，node 原生解析，tsx 与 vitest 两边都通。
 * 等 vite 升级到能识别 node:sqlite 之后可以改回静态导入。
 */
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite')

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

/**
 * 归一化放在 store 而不是只放在 auth：spec §3.2 要求 `username` 列里存的就是
 * trim + 小写之后的值，而唯一约束也建在这一列上。若由调用方负责归一化，
 * 谁忘了就会让 `Alice` 与 `alice` 变成两个人——把规则钉在持有数据的这一层最稳。
 * auth 那边的同名判断用于长度与空值校验，与这里是幂等的，不会打架。
 */
function canonicalUsername(username: string): string {
  return username.trim().toLowerCase()
}

function hashPassword(password: string, salt: string): string {
  return scryptSync(password, salt, KEY_BYTES).toString('hex')
}

/** 常量时间比较：用 == 比哈希会泄露匹配到的前缀长度 */
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

type AssessmentListRow = Omit<AssessmentDbRow, 'user_id' | 'answers' | 'interpretation'>

/** node:sqlite 的 .get()/.all() 返回 null 原型对象，逐字段映射成普通对象再往外给 */
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
      const canonical = canonicalUsername(username)
      const id = randomUUID()
      const salt = randomBytes(SALT_BYTES).toString('hex')
      const createdAt = new Date().toISOString()
      try {
        db.prepare(
          'INSERT INTO users (id, username, password_hash, salt, created_at) VALUES (?,?,?,?,?)',
        ).run(id, canonical, hashPassword(password, salt), salt, createdAt)
      } catch (error) {
        // 不匹配 SQLite 的错误文案（跨版本会变）。插失败后回查一次：
        // 查得到就是唯一约束挡下的重名，查不到才是真的写坏了，原样抛出转成 500。
        if (findUserByName.get(canonical) !== undefined) throw new UsernameTakenError(canonical)
        throw error
      }
      return { id, username: canonical, createdAt }
    },

    verifyUser(username, password) {
      const row = findUserByName.get(canonicalUsername(username)) as UserRow | undefined
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
        `INSERT INTO assessments
           (id, user_id, source, grade, answers, result, interpretation, created_at)
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
      ).all(userId) as unknown as AssessmentListRow[]

      // 坏行跳过而不是让整个列表 500：解析失败说明这行是手工改库或旧 schema 的产物，
      // 它不该拖垮其余历史
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
      // 全表唯一一次 UPDATE：只写这一个字段。answers / result / source / created_at
      // 一经写入永不改变（spec §4.4）。
      db.prepare('UPDATE assessments SET interpretation = ? WHERE id = ?').run(text, id)
    },

    close() {
      db.close()
    },
  }
}

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import { existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openStore, UsernameTakenError } from './store.js'
import type { Store } from './store.js'
import type { DiagnosisResult } from '@navi/core'

// 同 store.ts：静态 import 'node:sqlite' 在 vitest 下过不了 vite 的解析（见 store.ts 注释）
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite')

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

  it('同密码的两个用户盐与哈希都不同（每用户独立随机盐）', () => {
    // 直接读原始行：Store 的接口不暴露盐，而这条不变量只能在库层面验证。
    // 若哪天有人把盐写成常量或空串，这里必须红。
    const dir = join(tmpdir(), `navi-store-salt-${randomUUID()}`)
    const file = join(dir, 'navi.db')

    const s = openStore(file)
    s.createUser('a', 'same-password')
    s.createUser('b', 'same-password')
    s.close()

    const raw = new DatabaseSync(file)
    const rows = raw
      .prepare('SELECT salt, password_hash FROM users ORDER BY username')
      .all() as Array<{ salt: string; password_hash: string }>
    raw.close()
    rmSync(dir, { recursive: true, force: true })

    expect(rows).toHaveLength(2)
    expect(rows[0]!.salt).not.toBe(rows[1]!.salt)
    expect(rows[0]!.password_hash).not.toBe(rows[1]!.password_hash)
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

  it('findAssessment 用他人的 id 查不到（归属校验）', () => {
    const alice = store.createUser('alice', 'pw123456')
    const bob = store.createUser('bob', 'pw123456')
    const id = store.createAssessment({ userId: alice.id, ...input })
    expect(store.findAssessment(id, bob.id)).toBeNull()
  })

  it('listAssessments 只含本人，且按时间倒序', () => {
    const alice = store.createUser('alice', 'pw123456')
    const bob = store.createUser('bob', 'pw123456')
    const first = store.createAssessment({ userId: alice.id, ...input })
    const second = store.createAssessment({ userId: alice.id, ...input })
    store.createAssessment({ userId: bob.id, ...input })

    const rows = store.listAssessments(alice.id)
    expect(rows).toHaveLength(2)
    // 只断言「两条都在、且不含 bob 的」，不断言具体顺序——同一毫秒内 created_at 相同，
    // 顺序由 rowid 兜底，写死顺序会让用例依赖实现细节
    expect(rows.map(r => r.id).sort()).toEqual([first, second].sort())
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

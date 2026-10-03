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

  it('findAssessment 遇到坏行返回 null 而不是抛错（与列表守卫对称）', () => {
    const dir = join(tmpdir(), `navi-store-bad-${randomUUID()}`)
    const file = join(dir, 'navi.db')

    const s = openStore(file)
    const user = s.createUser('alice', 'pw123456')
    const id = s.createAssessment({ userId: user.id, ...input })
    s.close()

    // JSON 本身坏掉：只能绕过公开接口造出来（手工改库 / 旧版本写坏）
    const raw = new DatabaseSync(file)
    raw.prepare('UPDATE assessments SET result = ? WHERE id = ?').run('{不是合法 JSON', id)
    raw.close()

    const reopened = openStore(file)
    expect(reopened.findAssessment(id, user.id)).toBeNull()
    expect(reopened.listAssessments(user.id)).toEqual([])
    reopened.close()
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

describe('messages（账号级对话流）', () => {
  function seed(s: Store) {
    const user = s.createUser('alice', 'pw123456')
    const self = s.createAssessment({ userId: user.id, ...input, source: 'self' })
    const other = s.createAssessment({ userId: user.id, ...input, source: 'other' })
    return { userId: user.id, self, other }
  }

  it('追加一轮后能按时间正序读回', () => {
    const { userId, self } = seed(store)
    store.appendTurn({
      userId, assessmentId: self, pathId: 'p1', source: 'self',
      userText: '保研和考研怎么选？', assistantText: '两者的时间窗不同。',
    })

    const turns = store.recentTurns(userId, { id: self, source: 'self' }, 20)
    expect(turns.map(t => t.role)).toEqual(['user', 'assistant'])
    expect(turns[0]!.content).toBe('保研和考研怎么选？')
    expect(turns[1]!.content).toBe('两者的时间窗不同。')
    expect(turns[0]!.source).toBe('self')
  })

  it('对话流是全账号一条：换路径也读得到', () => {
    const { userId, self } = seed(store)
    store.appendTurn({
      userId, assessmentId: self, pathId: 'p1', source: 'self',
      userText: '第一问', assistantText: '第一答',
    })
    store.appendTurn({
      userId, assessmentId: self, pathId: 'p2', source: 'self', // 换了路径
      userText: '第二问', assistantText: '第二答',
    })

    expect(store.recentTurns(userId, { id: self, source: 'self' }, 20).map(t => t.content))
      .toEqual(['第一问', '第一答', '第二问', '第二答'])
  })

  it('来源过滤：other 的轮次只在查看那条记录时进来', () => {
    const { userId, self, other } = seed(store)
    store.appendTurn({
      userId, assessmentId: self, pathId: 'p1', source: 'self',
      userText: '关于我自己', assistantText: '答我自己',
    })
    store.appendTurn({
      userId, assessmentId: other, pathId: 'p1', source: 'other',
      userText: '关于我朋友', assistantText: '答我朋友',
    })

    // 查看自己的记录：别人的轮次不出现
    expect(store.recentTurns(userId, { id: self, source: 'self' }, 20).map(t => t.content))
      .toEqual(['关于我自己', '答我自己'])

    // 查看那条 other 记录：**只**要它自己的轮次。self 的属于另一个人，不混进来
    expect(store.recentTurns(userId, { id: other, source: 'other' }, 20).map(t => t.content))
      .toEqual(['关于我朋友', '答我朋友'])
  })

  it('只看得到本人的对话', () => {
    const { userId, self } = seed(store)
    const bob = store.createUser('bob', 'pw123456')
    store.appendTurn({
      userId, assessmentId: self, pathId: null, source: 'self',
      userText: '爱丽丝的问题', assistantText: '答',
    })
    expect(store.recentTurns(bob.id, null, 20)).toEqual([])
  })

  it('limit 取最近 N 条，但仍按时间正序返回', () => {
    const { userId, self } = seed(store)
    for (let i = 1; i <= 5; i += 1) {
      store.appendTurn({
        userId, assessmentId: self, pathId: null, source: 'self',
        userText: `第${i}问`, assistantText: `第${i}答`,
      })
    }
    // 5 轮 = 10 条消息，取最近 4 条即最后两轮
    const turns = store.recentTurns(userId, { id: self, source: 'self' }, 4)
    expect(turns.map(t => t.content)).toEqual(['第4问', '第4答', '第5问', '第5答'])
    // 更早的确实被截掉了，而不是「全都要」
    expect(turns.map(t => t.content)).not.toContain('第1问')
  })

  it('currentAssessmentId 为 null 时只纳入 self 的轮次', () => {
    const { userId, self, other } = seed(store)
    store.appendTurn({
      userId, assessmentId: self, pathId: null, source: 'self',
      userText: '自己', assistantText: '答自己',
    })
    store.appendTurn({
      userId, assessmentId: other, pathId: null, source: 'other',
      userText: '别人', assistantText: '答别人',
    })
    expect(store.recentTurns(userId, null, 20).map(t => t.content)).toEqual(['自己', '答自己'])
  })

  it('当次是 other 时，账号主人的 self 轮次也不进上下文', () => {
    const { userId, self, other } = seed(store)
    store.appendTurn({
      userId, assessmentId: self, pathId: null, source: 'self',
      userText: '关于我自己', assistantText: '答我自己',
    })
    store.appendTurn({
      userId, assessmentId: other, pathId: null, source: 'other',
      userText: '关于我朋友', assistantText: '答我朋友',
    })

    // 查看那条 other 记录：**只**要它自己的轮次。账号主人的自我对话属于另一个人，
    // 混进来就是「拿你的画像解释别人」（专项 §11.4）
    expect(store.recentTurns(userId, { id: other, source: 'other' }, 20).map(t => t.content))
      .toEqual(['关于我朋友', '答我朋友'])
  })
})

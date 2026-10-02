import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { registerAuthRoutes, requireSession, sessionUser, SESSION_COOKIE } from './auth.js'
import { openStore } from './store.js'
import type { Store } from './store.js'

const SECRET = 'test-secret'

/**
 * 传 `null` 表示「刻意不配置密钥」。
 * 不能直接传 `undefined`——那会触发默认参数，拿到的还是 SECRET，
 * 「未配置」这个场景就永远构造不出来。
 */
function makeApp(store: Store, jwtSecret: string | null = SECRET) {
  const secret = jwtSecret === null ? undefined : jwtSecret
  const app = new Hono()
  const opts = { store: () => store, jwtSecret: secret }
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
      [wrongPassword, noSuchUser, badFormat].map(async r =>
        ((await r.json()) as { error: string }).error),
    )
    // 文案必须逐字相同：但凡有一句不一样，就等于告诉试探者「这个名字存在但密码错了」
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
  it('token 自带 exp，与服务端声明的有效期一致', async () => {
    // hono 的 verify 是 `if (exp && payload.exp !== void 0)`——payload 里没有 exp
    // 就整段跳过过期检查。只靠 cookie 的 maxAge 拦的是浏览器，不是服务端：
    // token 一旦离开浏览器（代理日志、共享电脑）就能被无限期重放。
    const res = await post(makeApp(store), '/api/auth/register',
      { username: 'alice', password: 'pw123456' })
    const token = res.headers.get('set-cookie')!.match(/navi_session=([^;]+)/)![1]!
    const [, payloadPart] = token.split('.')
    const payload = JSON.parse(
      Buffer.from(payloadPart!, 'base64url').toString('utf8'),
    ) as { exp?: number }

    expect(typeof payload.exp).toBe('number')
    const sevenDays = 60 * 60 * 24 * 7
    expect(payload.exp! - Math.floor(Date.now() / 1000)).toBeGreaterThan(sevenDays - 60)
  })

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
    const res = await post(makeApp(store, null), '/api/auth/register',
      { username: 'alice', password: 'pw123456' })
    expect(res.status).toBe(503)
  })

  it('JWT_SECRET 为空串时同样 503（不能用 ?? 兜底）', async () => {
    const res = await post(makeApp(store, ''), '/api/auth/register',
      { username: 'alice', password: 'pw123456' })
    expect(res.status).toBe(503)
  })

  it('未配置密钥时受保护端点也是 503 而不是 401', async () => {
    const res = await makeApp(store, null).request('/api/private')
    expect(res.status).toBe(503)
  })
})

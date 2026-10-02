import type { Context, Hono, MiddlewareHandler } from 'hono'
import { sign, verify } from 'hono/jwt'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import { UsernameTakenError } from './store.js'
import type { Store, User } from './store.js'

export const SESSION_COOKIE = 'navi_session'

const ALG = 'HS256'
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7 // 7 天
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

/**
 * trim + 小写；空或超长返回 null（spec §6）。
 * 归一化本身在 store 里也做了一遍（那是数据不变量），这里用它来做长度与空值校验——
 * 两处都是同一个幂等规则，不会打架。
 */
function normalizeUsername(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const name = raw.trim().toLowerCase()
  return name === '' || name.length > MAX_USERNAME ? null : name
}

export function requireSession(opts: AuthOptions): MiddlewareHandler {
  return async (c, next) => {
    const denied = unavailable(c, opts)
    if (denied !== null) return denied

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

/** 只能在 requireSession 之后调用 */
export function sessionUser(c: Context): User {
  return c.get('naviUser')
}

export function registerAuthRoutes(app: Hono, opts: AuthOptions): void {
  app.post('/api/auth/register', async c => {
    const denied = unavailable(c, opts)
    if (denied !== null) return denied

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
    if (denied !== null) return denied

    const body = await readBody(c)
    if (body === null) return c.json({ error: '请求体不是合法 JSON' }, 400)

    // 用户名格式非法也走 401 同一句文案：换成 400 就等于告诉试探者「这个名字格式不对」
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

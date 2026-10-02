import { readFileSync } from 'node:fs'
import { serve } from '@hono/node-server'
import { createApp } from './server.js'
import type { KnowledgeBundle } from '@navi/core'

// .env 只在服务端读（硬性约束：前端不得出现任何 API Key）。
//
// 必须显式指向仓库根：loadEnvFile 无参时按 process.cwd() 解析，而
// `pnpm --filter @navi/api dev` 的 cwd 是 apps/api，根目录的 .env 永远读不到——
// 症状是「按文档配好 Key 仍走降级」，与完全没配无法区分。
//
// 文件不存在时抛错，属正常情况，忽略即可——端点会走降级分支。
try {
  process.loadEnvFile(new URL('../../../.env', import.meta.url))
} catch {
  // 没有 .env，按未配置模型处理
}

const knowledgePath = new URL('../../../packages/knowledge/dist/knowledge.json', import.meta.url)
const bundle = JSON.parse(readFileSync(knowledgePath, 'utf8')) as KnowledgeBundle

const port = Number(process.env.PORT ?? 3000)
serve({ fetch: createApp(bundle).fetch, port }, info => {
  console.log(`[api] listening on http://localhost:${info.port}`)
})

import { readFileSync } from 'node:fs'
import { serve } from '@hono/node-server'
import { createApp } from './server.js'
import type { KnowledgeBundle } from '@navi/core'

// .env 只在服务端读（硬性约束：前端不得出现任何 API Key）。
// 文件不存在时 loadEnvFile 会抛错，属正常情况，忽略即可——端点会走降级分支。
try {
  process.loadEnvFile()
} catch {
  // 没有 .env，按未配置模型处理
}

const knowledgePath = new URL('../../../packages/knowledge/dist/knowledge.json', import.meta.url)
const bundle = JSON.parse(readFileSync(knowledgePath, 'utf8')) as KnowledgeBundle

const port = Number(process.env.PORT ?? 3000)
serve({ fetch: createApp(bundle).fetch, port }, info => {
  console.log(`[api] listening on http://localhost:${info.port}`)
})

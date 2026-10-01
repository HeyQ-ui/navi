import { readFileSync } from 'node:fs'
import { serve } from '@hono/node-server'
import { createApp } from './server.js'
import type { KnowledgeBundle } from '@navi/core'

const knowledgePath = new URL('../../../packages/knowledge/dist/knowledge.json', import.meta.url)
const bundle = JSON.parse(readFileSync(knowledgePath, 'utf8')) as KnowledgeBundle

const port = Number(process.env.PORT ?? 3000)
serve({ fetch: createApp(bundle).fetch, port }, info => {
  console.log(`[api] listening on http://localhost:${info.port}`)
})

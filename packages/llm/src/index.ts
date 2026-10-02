import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { streamText } from 'ai'
import type { LanguageModel, ModelMessage } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import { diagnose } from '@navi/core'
import type { Answers, KnowledgeBundle } from '@navi/core'
import { buildChatMessages, buildInterpretMessages } from './context.js'
import type { KnowledgeSlice } from './context.js'

const PROMPT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'prompts')

/** 提示词不硬编码进 TypeScript（设计文档 §8.8） */
function loadPrompt(name: 'interpret' | 'chat'): string {
  return readFileSync(join(PROMPT_DIR, `${name}.md`), 'utf8').trim()
}

export interface StreamOptions {
  /** 测试注入用；生产不传，走 DeepSeek */
  model?: LanguageModel
}

/** DeepSeek 兼容 OpenAI 的 /chat/completions（设计文档 §8.6） */
export function createDeepSeekModel(env: NodeJS.ProcessEnv = process.env): LanguageModel {
  const apiKey = env.DEEPSEEK_API_KEY
  if (!apiKey) throw new Error('未配置 DEEPSEEK_API_KEY')

  // 用 || 而非 ??：.env.example 里这两项是留空的，loadEnvFile 会把它们设成空串，
  // ?? 只挡 null/undefined，空串会穿透——baseURL 为空会让 createOpenAI 直接抛错
  const provider = createOpenAI({
    apiKey,
    baseURL: env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1',
  })
  return provider.chat(env.DEEPSEEK_MODEL || 'deepseek-chat')
}

/** 服务端自己重算诊断，不接受客户端传来的结果（§5.1 确定性） */
function sliceOf(answers: Answers, bundle: KnowledgeBundle, pathId: string): KnowledgeSlice {
  return { bundle, result: diagnose(answers, bundle), pathId, answers }
}

/**
 * v7 不允许 system 角色出现在 messages 里（会抛 AI_InvalidPromptError），
 * 必须走 instructions。context 层产出的是 SDK 无关的「system + 轮次」规范形态，
 * 到这一个边界上再拆开——差异只此一处。
 */
function splitSystem(messages: ModelMessage[]): {
  instructions: string
  turns: ModelMessage[]
} {
  const [first, ...turns] = messages
  if (first?.role === 'system') return { instructions: String(first.content), turns }
  return { instructions: '', turns: messages }
}

type StreamResult = ReturnType<typeof streamText>

export function streamInterpret(
  input: { answers: Answers; pathId: string; bundle: KnowledgeBundle },
  options: StreamOptions = {},
): StreamResult {
  const knowledge = sliceOf(input.answers, input.bundle, input.pathId)
  const { instructions, turns } = splitSystem(
    buildInterpretMessages({ knowledge, systemPrompt: loadPrompt('interpret') }),
  )
  return streamText({
    model: options.model ?? createDeepSeekModel(),
    instructions,
    messages: turns,
  })
}

export function streamChat(
  input: {
    answers: Answers
    pathId: string
    messages: ModelMessage[]
    bundle: KnowledgeBundle
  },
  options: StreamOptions = {},
): StreamResult {
  const knowledge = sliceOf(input.answers, input.bundle, input.pathId)
  const { instructions, turns } = splitSystem(
    buildChatMessages({
      knowledge,
      systemPrompt: loadPrompt('chat'),
      history: input.messages,
    }),
  )
  return streamText({
    model: options.model ?? createDeepSeekModel(),
    instructions,
    messages: turns,
  })
}

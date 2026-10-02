import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { streamText } from 'ai'
import type { LanguageModel, ModelMessage } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import { diagnose } from '@navi/core'
import type { Answers, DiagnosisResult, KnowledgeBundle } from '@navi/core'
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

/**
 * 结果只能来自服务端自己：重算，或读本服务端落库的快照。绝不接受请求体里的结果
 * （设计文档 §1.3「确定性优先」、§4.1 决策一）。
 *
 * 传预置 result 是为了让解读与用户眼前显示的数字一致：知识库会在测评记录存续期间
 * 被重建（§12.2 内容工作与开发并行），而 bundle 在进程启动时读一次，跨重启重算会
 * 得出与页面不同的匹配度——页面写着 55、模型却解释 62。
 */
function sliceOf(
  answers: Answers, bundle: KnowledgeBundle, pathId: string, result?: DiagnosisResult,
): KnowledgeSlice {
  return { bundle, result: result ?? diagnose(answers, bundle), pathId, answers }
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
  input: { answers: Answers; pathId: string; bundle: KnowledgeBundle; result?: DiagnosisResult },
  options: StreamOptions = {},
): StreamResult {
  const knowledge = sliceOf(input.answers, input.bundle, input.pathId, input.result)
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
    result?: DiagnosisResult
  },
  options: StreamOptions = {},
): StreamResult {
  const knowledge = sliceOf(input.answers, input.bundle, input.pathId, input.result)
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

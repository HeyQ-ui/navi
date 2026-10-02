import { useEffect, useMemo } from 'react'
import { useChat, useCompletion } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'
import type { Grade } from '../api.js'

interface Props {
  answers: Record<string, number>
  grade: Grade
  pathId: string
}

/**
 * 解读 + 追问，都锚在「本路径」上（设计文档 §8.5）。
 *
 * 换路径时由父组件改 key 触发重新挂载，因此这里不必手写重置逻辑——
 * 上一路径的解读文字与对话历史随卸载一起消失。
 */
export function PathAssistant({ answers, grade, pathId }: Props) {
  const {
    completion, complete, isLoading: interpreting, error: interpretError,
  } = useCompletion({
    api: '/api/interpret',
    // 服务端用 toTextStreamResponse()，响应体是纯文本。useCompletion 默认按
    // "data"（UI message 事件流）解析：纯文本里没有 data: 事件行，解析结果恒为空串
    // 且不抛错——症状是「生成结束后解读区变空白」。
    streamProtocol: 'text',
    body: { answers, grade, pathId },
  })

  // v7 的 useChat 不再接受 api 选项，改为显式 transport
  const transport = useMemo(
    () => new DefaultChatTransport({ api: '/api/chat', body: { answers, grade, pathId } }),
    [answers, grade, pathId],
  )
  const {
    messages, sendMessage, status, error: chatError,
  } = useChat({ transport })

  // 进入这条路径就生成一次解读。依赖只认 pathId：同一次会话里答案与年级不会变
  useEffect(() => {
    void complete('')
  }, [pathId])

  return (
    <section className="mx-auto mt-8 max-w-3xl border-t pt-6">
      <h2 className="mb-2 text-lg font-semibold">个性化解读</h2>
      {interpretError ? (
        <p className="text-amber-600">个性化解读暂不可用，其余诊断结果不受影响。</p>
      ) : interpreting && completion === '' ? (
        <p className="text-gray-500">正在生成……</p>
      ) : (
        <p className="whitespace-pre-wrap leading-relaxed">{completion}</p>
      )}

      <h2 className="mb-2 mt-6 text-lg font-semibold">追问</h2>
      <ul className="mb-3 space-y-2">
        {messages.map(message => (
          <li key={message.id} className="text-sm">
            <span className="font-medium">{message.role === 'user' ? '你' : 'Navi'}：</span>
            <span className="whitespace-pre-wrap">
              {message.parts.flatMap(part => (part.type === 'text' ? [part.text] : [])).join('')}
            </span>
          </li>
        ))}
      </ul>

      {chatError && <p className="mb-2 text-amber-600">追问暂时不可用，请稍后重试。</p>}

      <form
        onSubmit={event => {
          event.preventDefault()
          const form = event.currentTarget
          const input = new FormData(form).get('question')
          const question = typeof input === 'string' ? input.trim() : ''
          if (question === '') return
          sendMessage({ text: question })
          form.reset()
        }}
      >
        <input
          name="question"
          placeholder="就这条路径追问……"
          className="w-full border p-2"
          disabled={status === 'submitted' || status === 'streaming'}
        />
      </form>
    </section>
  )
}

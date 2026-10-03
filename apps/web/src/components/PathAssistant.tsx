import { useEffect, useMemo } from 'react'
import { useChat, useCompletion } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'
import { buildChatBody, fetchChatHistory } from '../api.js'
import type { ChatMessage } from '../api.js'

interface Props {
  /** 解读锚在这条测评记录上——服务端据此从自己的库取答案（spec §4.2） */
  assessmentId: string
  pathId: string
  /** 历史详情带回来的解读。有值就直接显示，不再重新生成（spec §5.2） */
  interpretation?: string | null
}

/**
 * 解读 + 追问。
 *
 * 解读锚在「本路径」上（设计文档 §8.5）：换路径时由父组件改 key 触发重新挂载，
 * 解读随之重来。**追问不同**——它是账号级的一条连续流（专项 §11.3），换路径、
 * 换测评、下次登录都接着上文，所以对话是通过接口读回来的，不随挂载清空。
 */
export function PathAssistant({ assessmentId, pathId, interpretation }: Props) {
  const hasStored = interpretation !== undefined && interpretation !== null

  const {
    completion, complete, isLoading: interpreting, error: interpretError,
  } = useCompletion({
    api: '/api/interpret',
    // 服务端用 toTextStreamResponse()，响应体是纯文本。useCompletion 默认按
    // "data"（UI message 事件流）解析：纯文本里没有 data: 事件行，解析结果恒为空串
    // 且不抛错——症状是「生成结束后解读区变空白」。
    streamProtocol: 'text',
    body: { assessmentId, pathId },
  })

  // v7 的 useChat 不再接受 api 选项，改为显式 transport。
  // prepareSendMessagesRequest 让请求体只带本轮问题——历史在服务端手里，
  // 客户端上传的那份它一概不看（专项 §11.3）。
  const transport = useMemo(
    () => new DefaultChatTransport({
      api: '/api/chat',
      prepareSendMessagesRequest: ({ messages: sent }) => ({
        body: buildChatBody({ assessmentId, pathId, messages: sent as ChatMessage[] }),
      }),
    }),
    [assessmentId, pathId],
  )
  const {
    messages, setMessages, sendMessage, status, error: chatError,
  } = useChat({ transport })

  useEffect(() => {
    // 已有存下来的解读就不重新生成。hook 本身仍要**无条件**调用，
    // 变的只是这个 effect——写成条件调用 hook 会直接崩。
    if (hasStored) return
    void complete('')
  }, [pathId, hasStored])

  useEffect(() => {
    // 对话是账号级的：换路径、换测评、下次登录都读同一条流，所以每次挂载都重新拉。
    // 拉失败不阻断追问——用户照样能问，只是看不到上文。
    let cancelled = false
    void fetchChatHistory(assessmentId)
      .then(history => { if (!cancelled) setMessages(history) })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [assessmentId, setMessages])

  const text = hasStored ? interpretation : completion

  return (
    <section className="mx-auto mt-8 max-w-3xl border-t pt-6">
      <h2 className="mb-2 text-lg font-semibold">个性化解读</h2>
      {interpretError !== undefined && !hasStored ? (
        <p className="text-amber-600">个性化解读暂不可用，其余诊断结果不受影响。</p>
      ) : !hasStored && interpreting && completion === '' ? (
        <p className="text-gray-500">正在生成……</p>
      ) : (
        <p className="whitespace-pre-wrap leading-relaxed">{text}</p>
      )}

      <h2 className="mb-2 mt-6 text-lg font-semibold">追问</h2>
      <p className="mb-2 text-sm text-gray-500">
        最近的对话都在这里。换路径、换一次测评都会接着上文。
      </p>
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

      {chatError !== undefined && (
        <p className="mb-2 text-amber-600">追问暂时不可用，请稍后重试。</p>
      )}

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

import { useEffect, useMemo } from 'react'
import { useChat, useCompletion } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'
import { buildChatBody, fetchChatHistory } from '../api.js'
import type { ChatMessage } from '../api.js'
import { splitSuggestions } from '../lib/suggestions.js'

interface Props {
  /** 解读锚在这条测评记录上——服务端据此从自己的库取答案 */
  assessmentId: string
  pathId: string
  /** 历史详情带回来的解读。有值就直接显示，不再重新生成 */
  interpretation?: string | null
}

/**
 * 04 个性化解读：流式正文 + 建议问题芯片 + 账号级追问。
 *
 * 解读锚在「本路径」上：换路径由父组件改 key 触发重挂载。追问不同——
 * 它是账号级连续流，换路径、换测评都接着上文，所以历史是读回来的。
 */
export function InterpretSection({ assessmentId, pathId, interpretation }: Props) {
  const hasStored = interpretation !== undefined && interpretation !== null

  const {
    completion, complete, isLoading: interpreting, error: interpretError,
  } = useCompletion({
    api: '/api/interpret',
    // 服务端用 toTextStreamResponse()，响应体是纯文本；默认按事件流解析会让
    // 解读在生成结束后变空白
    streamProtocol: 'text',
    body: { assessmentId, pathId },
  })

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
    // hook 必须无条件调用，变的只有这个 effect
    if (hasStored) return
    void complete('')
  }, [pathId, hasStored])

  useEffect(() => {
    let cancelled = false
    void fetchChatHistory(assessmentId)
      .then(history => {
        if (cancelled) return
        // 用更新函数而不是覆盖：历史是异步来的，直接覆盖会冲掉用户在等待期已发出的一轮
        setMessages(prev => (prev.length === 0 ? history : [...history, ...prev]))
      })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [assessmentId, setMessages])

  const raw = hasStored ? interpretation : completion
  const streaming = !hasStored && interpreting
  const { body, suggestions } = splitSuggestions(raw ?? '', streaming)

  // 503（缺 DEEPSEEK_API_KEY）在任何输出之前就到：整区隐藏（spec §7.3）。
  // 已有输出的中断不走这里——保留内容 + 「继续生成解读」
  if (!hasStored && interpretError !== undefined && (completion ?? '') === '') return null

  const chatBusy = status === 'submitted' || status === 'streaming'

  function ask(question: string) {
    if (question === '' || chatBusy) return
    sendMessage({ text: question })
  }

  return (
    <section>
      <div className="section-head">
        <span className="section-num">04</span>
        <h2 className="section-title">个性化解读</h2>
      </div>

      <p className="whitespace-pre-wrap text-[15px] leading-[1.9]">
        {body}
        {streaming && <span className="stream-cursor" aria-hidden />}
      </p>

      {suggestions.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {suggestions.map(question => (
            <button
              key={question}
              type="button"
              className="chip border-accent/30 bg-accent-soft text-accent-deep transition-colors hover:border-accent"
              onClick={() => ask(question)}
            >
              {question}
            </button>
          ))}
        </div>
      )}

      {!hasStored && interpretError !== undefined && (completion ?? '') !== '' && (
        <button
          type="button"
          className="chip mt-4 border-line bg-paper text-ink-2 hover:border-accent hover:text-accent-deep"
          onClick={() => void complete('')}
        >
          继续生成解读
        </button>
      )}

      <h3 className="mb-2 mt-8 font-serif text-[17px] font-semibold">追问</h3>
      <p className="mb-3 text-[13px] text-ink-3">最近的对话都在这里，换路径、换一次测评都会接着上文。</p>

      {messages.length > 0 && (
        <ul className="mb-4 space-y-3">
          {messages.map(message => (
            <li key={message.id} className="text-[14px] leading-[1.8]">
              <span className="font-medium">{message.role === 'user' ? '你：' : 'Navi：'}</span>
              <span className="whitespace-pre-wrap">
                {message.parts.flatMap(part => (part.type === 'text' ? [part.text] : [])).join('')}
              </span>
            </li>
          ))}
        </ul>
      )}

      {chatError !== undefined && (
        <p className="mb-2 text-[13px] text-warn">追问暂时不可用，请稍后重试。</p>
      )}

      <form
        className="flex gap-2"
        onSubmit={event => {
          event.preventDefault()
          const form = event.currentTarget
          const input = new FormData(form).get('question')
          const question = typeof input === 'string' ? input.trim() : ''
          if (question === '') return
          ask(question)
          form.reset()
        }}
      >
        <input
          name="question"
          placeholder="就这条路径追问……"
          className="field-input flex-1"
          disabled={chatBusy}
        />
        <button type="submit" className="btn-primary px-5" disabled={chatBusy}>发送</button>
      </form>
    </section>
  )
}

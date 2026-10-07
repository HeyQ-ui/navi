import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
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

  // 默认只露前 6 行（6 × 1.9 × 15px = 171px），其余折叠；展开后不再收
  const [expanded, setExpanded] = useState(false)
  const [overflowing, setOverflowing] = useState(false)
  const bodyRef = useRef<HTMLParagraphElement | null>(null)

  // 只有真的超过 6 行才折：短解读不该出现模糊与展开按钮。
  // 用 layout effect 在绘制前量，避免先铺满再收起的跳动
  useLayoutEffect(() => {
    const el = bodyRef.current
    if (el === null) return
    setOverflowing(el.scrollHeight > el.clientHeight + 1)
  }, [body, expanded, streaming])

  const showClamp = !expanded && overflowing

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

      <div className="relative">
        <p
          ref={bodyRef}
          className={`whitespace-pre-wrap text-[15px] leading-[1.9] ${
            showClamp ? 'max-h-[171px] overflow-hidden' : ''
          }`}
        >
          {body}
          {streaming && <span className="stream-cursor" aria-hidden />}
        </p>
        {showClamp && (
          <>
            {/* 渐进模糊：底部先糊化再淡出，暗示「还有下文」 */}
            <span
              aria-hidden
              className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-paper via-paper/70 to-transparent"
            />
            <span
              aria-hidden
              className="pointer-events-none absolute inset-x-0 bottom-0 h-16 backdrop-blur-[3px] [mask-image:linear-gradient(to_top,black_25%,transparent)]"
            />
            <span className="absolute inset-x-0 bottom-0 flex justify-center">
              <button
                type="button"
                className="chip border-accent/30 bg-surface/90 text-accent-deep transition-colors hover:border-accent"
                onClick={() => setExpanded(true)}
              >
                展开个性化解读
              </button>
            </span>
          </>
        )}
      </div>

      {!hasStored && interpretError !== undefined && (completion ?? '') !== '' && (
        <button
          type="button"
          className="chip mt-4 border-line bg-paper text-ink-2 hover:border-accent hover:text-accent-deep"
          onClick={() => void complete('')}
        >
          继续生成解读
        </button>
      )}

      <h3 className="mb-1 mt-8 font-serif text-[17px] font-semibold">追问</h3>
      <p className="mb-3 text-[13px] text-ink-3">Navi也可能会出错，重要信息请仔细核对。</p>

      <div className="h-[360px] overflow-y-auto rounded-panel border border-line bg-surface p-5">
        {messages.length === 0 ? (
          <p className="text-[13px] text-ink-3">还没有追问。想知道什么，直接问就好。</p>
        ) : (
          <ul className="space-y-3">
            {messages.map(message => {
              // 你在右、Navi 在左：位置本身就是角色标识，文字标签只留给读屏
              const mine = message.role === 'user'
              return (
                <li key={message.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                  <span
                    className={`max-w-[80%] whitespace-pre-wrap rounded-lg px-4 py-2 text-[14px] leading-[1.8] ${
                      mine ? 'bg-accent-soft' : 'bg-paper'
                    }`}
                  >
                    <span className="sr-only">{mine ? '你' : 'Navi'}：</span>
                    {message.parts.flatMap(part => (part.type === 'text' ? [part.text] : [])).join('')}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {chatError !== undefined && (
        <p className="mt-2 text-[13px] text-warn">追问暂时不可用，请稍后重试。</p>
      )}

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

      <form
        className="mt-3 flex gap-2"
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

import { useMemo } from 'react'
import type { Block } from '@navi/core'
import type { Grade } from '../api.js'

/**
 * 知识块渲染（前端重设计 spec §6）。
 * 块内 HTML 是自有编译器的产物，属可信内容，直接 dangerouslySetInnerHTML，
 * 用作用域 CSS（.kb）统一排版；不引 sanitizer。
 * 时间线与行动指南需要结构，用 DOMParser 拆 <li> 里的 <strong> 前缀。
 */

const CHIP_STYLES: Record<string, { label: string; className: string }> = {
  timeline: { label: '时间线', className: 'border-line bg-paper text-ink-2' },
  guide: { label: '行动指南', className: 'border-ok/30 bg-ok-soft text-ok' },
  myth: { label: '误区', className: 'border-warn/30 bg-warn-soft text-warn' },
  cost: { label: '代价', className: 'border-line bg-paper text-ink' },
  risk: { label: '风险', className: 'border-bad/25 bg-bad-soft text-bad' },
  compare: { label: '对比', className: 'border-line bg-paper text-ink-2' },
  boundary: { label: '诚实边界', className: 'border-line bg-paper text-ink-2' },
  references: { label: '参考文献', className: 'border-line bg-paper text-ink-2' },
}

const NEUTRAL_CHIP = 'border-line bg-paper text-ink-2'

const GRADE_WORDS: Record<Grade, string> = {
  freshman: '大一', sophomore: '大二', junior: '大三', senior: '大四',
}

interface ListItem {
  label: string
  text: string
}

/** 拆 <ul><li><strong>前缀</strong> 正文</li>；拆不出（无 li）返回 null 走富文本降级 */
function parseListItems(html: string): ListItem[] | null {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const items = [...doc.querySelectorAll('li')]
  if (items.length === 0) return null
  return items.map(li => {
    const strong = li.querySelector('strong')
    const label = strong?.textContent?.trim() ?? ''
    const text = (li.textContent ?? '')
      .replace(strong?.textContent ?? '', '')
      .replace(/^[\s·]+/, '')
      .trim()
    return { label, text }
  })
}

function parsedTitle(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  return doc.querySelector('h2')?.textContent?.trim() ?? ''
}

function RichText({ html, className = '' }: { html: string; className?: string }) {
  return <div className={`kb ${className}`} dangerouslySetInnerHTML={{ __html: html }} />
}

function TimelineBlock({ block, grade }: { block: Block; grade: Grade | null }) {
  const items = useMemo(() => parseListItems(block.html), [block.html])
  if (items === null) return <RichText html={block.html} />

  const word = grade === null ? null : GRADE_WORDS[grade]
  const nowIndex = word === null ? -1 : items.findIndex(item => item.label.includes(word))

  return (
    <ol className="border-l border-line pl-0">
      {items.map((item, index) => (
        <li key={index} className="relative mb-4 pl-6 last:mb-0">
          <span
            className={`absolute -left-[5px] top-[7px] h-[9px] w-[9px] rounded-full ${
              index === nowIndex ? 'bg-accent' : 'border border-line bg-surface'
            }`}
          />
          <div className="flex items-center gap-2">
            <span className="font-num text-[13px] font-medium text-ink-2">{item.label}</span>
            {index === nowIndex && (
              <span className="chip border-accent/30 bg-accent-soft text-accent-deep">现在</span>
            )}
          </div>
          <p className="text-[15px] leading-[1.8]">{item.text}</p>
        </li>
      ))}
    </ol>
  )
}

function GuideBlock({ block }: { block: Block }) {
  const items = useMemo(() => parseListItems(block.html), [block.html])
  if (items === null) return <RichText html={block.html} />
  return (
    <div className="grid gap-2.5">
      {items.map((item, index) => (
        <div key={index} className="grid grid-cols-[92px_1fr] gap-4">
          <span className="font-num text-[13px] font-medium leading-7 text-ink-2">{item.label}</span>
          <p className="text-[15px] leading-[1.8]">{item.text}</p>
        </div>
      ))}
    </div>
  )
}

function BlockContent({ block, grade }: { block: Block; grade: Grade | null }) {
  switch (block.type) {
    case 'timeline':
      return <TimelineBlock block={block} grade={grade} />
    case 'guide':
      return <GuideBlock block={block} />
    case 'cost':
      return <RichText html={block.html} className="kb-cost" />
    case 'risk':
      return <RichText html={block.html} className="kb-risk" />
    default:
      // myth / compare / boundary / free / 未识别类型：富文本排版，页面不崩
      return <RichText html={block.html} />
  }
}

export function BlockRenderer({ blocks, grade }: { blocks: Block[]; grade: Grade | null }) {
  return (
    <div className="space-y-5">
      {blocks.map((block, index) => {
        const chip = CHIP_STYLES[block.type]
        const title = block.title ?? (block.type === 'timeline' ? parsedTitle(block.html) : '')
        return (
          <section key={index} className="panel p-6">
            <header className="mb-4 flex items-center gap-3">
              <span className={`chip ${chip?.className ?? NEUTRAL_CHIP}`}>
                {chip?.label ?? block.type}
              </span>
              {title !== '' && (
                <h3 className="font-serif text-[17px] font-semibold">{title}</h3>
              )}
            </header>
            <BlockContent block={block} grade={grade} />
          </section>
        )
      })}
    </div>
  )
}

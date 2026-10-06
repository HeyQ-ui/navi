import { describe, it, expect } from 'vitest'
import { splitSuggestions, SUGGESTION_MARKER } from './suggestions.js'

describe('splitSuggestions', () => {
  it('没有标记时原样返回', () => {
    expect(splitSuggestions('正文内容', false)).toEqual({ body: '正文内容', suggestions: [] })
  })

  it('流结束后解析出建议问题，标记行不进正文', () => {
    const text = `保研是时间窗最紧的一条路。\n${SUGGESTION_MARKER}保研率大概多少？ | 大一该做什么？`
    expect(splitSuggestions(text, false)).toEqual({
      body: '保研是时间窗最紧的一条路。',
      suggestions: ['保研率大概多少？', '大一该做什么？'],
    })
  })

  it('空项过滤、最多 3 条、兼容全角分隔符', () => {
    const text = `${SUGGESTION_MARKER}a |  ｜ b | c | d`
    expect(splitSuggestions(text, false).suggestions).toEqual(['a', 'b', 'c'])
  })

  it('流式中：标记行整体隐藏，不出芯片', () => {
    const text = `正文。\n${SUGGESTION_MARKER}只写了一半`
    expect(splitSuggestions(text, true)).toEqual({ body: '正文。', suggestions: [] })
  })

  it('流式中：正文末尾刚写出半截标记时，连半截也不显示', () => {
    for (let len = 1; len < SUGGESTION_MARKER.length; len += 1) {
      const tail = SUGGESTION_MARKER.slice(0, len)
      const { body } = splitSuggestions(`正文${tail}`, true)
      expect(body).toBe('正文')
    }
  })

  it('流结束后半截标记就是正文的一部分，照常显示', () => {
    expect(splitSuggestions('正文【可以问', false).body).toBe('正文【可以问')
  })
})

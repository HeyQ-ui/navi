import { useEffect } from 'react'

/** 浏览器标签页标题随页面更新（前端重设计 spec §4.1） */
export function useTitle(title: string): void {
  useEffect(() => {
    document.title = title
  }, [title])
}

import '@testing-library/jest-dom/vitest'

// jsdom 不实现 IntersectionObserver，而结果页的滚动显现组件 Reveal 依赖它
// （spec §3.4 第 4 条）。这里补一个空实现：单测断言的是内容渲染，
// 不依赖显现动画本身，故 observe/unobserve/disconnect 无需真实行为。
if (typeof (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver === 'undefined') {
  class IntersectionObserverStub {
    observe(): void {
      // 测试环境无需真实观察
    }
    unobserve(): void {
      // 测试环境无需真实观察
    }
    disconnect(): void {
      // 测试环境无需真实观察
    }
    takeRecords(): never[] {
      return []
    }
  }

  Object.defineProperty(globalThis, 'IntersectionObserver', {
    configurable: true,
    writable: true,
    value: IntersectionObserverStub,
  })
}

// Node 25 暴露了一个未初始化的全局 localStorage（缺少 clear 等方法），
// 会遮蔽 jsdom 提供的实现。这里补一个等价的内存实现。
if (typeof (globalThis as { localStorage?: Storage }).localStorage?.clear !== 'function') {
  const store = new Map<string, string>()
  const memoryStorage: Storage = {
    getItem: key => store.get(key) ?? null,
    setItem: (key, value) => { store.set(key, String(value)) },
    removeItem: key => { store.delete(key) },
    clear: () => { store.clear() },
    key: index => [...store.keys()][index] ?? null,
    get length() { return store.size },
  }

  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: memoryStorage,
  })
}

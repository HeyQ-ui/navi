import '@testing-library/jest-dom/vitest'

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

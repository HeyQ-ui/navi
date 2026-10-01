import { describe, it, expect } from 'vitest'

describe('workspace smoke test', () => {
  it('runs vitest in the core package', () => {
    expect(1 + 1).toBe(2)
  })
})

import base from '../../eslint.config.js'

export default [
  ...base,
  {
    files: ['src/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          {
            group: ['react', 'react-*', 'hono', 'express', 'fastify', 'vite', 'ai', '@ai-sdk/*', '@navi/llm', '@navi/api', '@navi/web'],
            message: 'core 是纯逻辑层，不得引入框架或上层依赖（设计文档 §3.3）',
          },
        ],
      }],
      'no-restricted-globals': ['error',
        { name: 'fetch', message: 'core 不得发起网络请求（设计文档 §3.3）' },
        { name: 'XMLHttpRequest', message: 'core 不得发起网络请求（设计文档 §3.3）' },
      ],
    },
  },
]

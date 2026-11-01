// 后端 ESLint 配置（flat config）：Node + ESM，只拦截真正的低级错误
import js from '@eslint/js'
import globals from 'globals'

export default [
  {
    ignores: ['node_modules/**', 'data/**', 'prisma/migrations/**', '**/*.min.js']
  },
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node }
    },
    rules: {
      ...js.configs.recommended.rules,
      // 未使用变量：允许下划线前缀占位；catch 参数常被忽略，不报错
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none', ignoreRestSiblings: true }],
      // 允许空 catch（本项目大量「失败静默降级」是刻意设计）
      'no-empty': ['error', { allowEmptyCatch: true }],
      // while(true) / for(;;) 是有意的轮询写法
      'no-constant-condition': ['error', { checkLoops: false }]
    }
  },
  {
    // 管理脚本属于 CLI，直接输出到终端
    files: ['scripts/**/*.mjs'],
    rules: {
      'no-console': 'off'
    }
  }
]

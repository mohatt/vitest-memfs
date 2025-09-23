import { resolve } from 'path'
import { defineConfig, defaultExclude } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['**/*.test.?(c|m)[jt]s?(x)', '**/__tests__/*.?(c|m)[jt]s?(x)'],
    exclude: [...defaultExclude, '**/__fixtures__'],
    setupFiles: [`./test/setup-test${process.env.USE_FS_MOCK ? '-vfs' : ''}.ts`],
    expandSnapshotDiff: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.?(c|m)[jt]s?(x)'],
    },
    chaiConfig: {
      truncateThreshold: 500,
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@test': resolve(__dirname, 'test'),
    },
  },
})

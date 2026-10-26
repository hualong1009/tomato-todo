// 将 src/mcp/entry.ts 打包为完全自包含的 CJS 文件（out/mcp-entry.cjs），
// 供 ELECTRON_RUN_AS_NODE 模式直接运行。
import { build } from 'vite'
import { resolve } from 'node:path'

await build({
  configFile: false,
  logLevel: 'warn',
  resolve: {
    alias: {
      '@shared': resolve('src/shared')
    }
  },
  build: {
    lib: {
      entry: resolve('src/mcp/entry.ts'),
      formats: ['cjs'],
      fileName: () => 'mcp-entry.cjs'
    },
    outDir: 'out',
    emptyOutDir: false,
    target: 'node20',
    minify: false,
    rollupOptions: {
      external: [/^node:/]
    }
  }
})
console.log('out/mcp-entry.cjs 构建完成')

import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/**
 * 移动端（Capacitor / 浏览器）Web 构建配置。
 *
 * 复用同一份 React 渲染层，但不打包 Electron 主进程与 preload：
 * 运行时由 `src/renderer/src/platform` 安装 Web 版 `window.api`。
 */
export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@renderer': resolve(__dirname, 'src/renderer/src'),
      '@shared': resolve(__dirname, 'src/shared')
    }
  },
  build: {
    outDir: resolve(__dirname, 'dist-mobile'),
    emptyOutDir: true,
    target: 'es2020'
  },
  server: {
    port: 5180,
    strictPort: true
  }
})

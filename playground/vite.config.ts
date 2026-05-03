import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'

export default defineConfig({
  base: process.env.VITE_BASE_PATH ?? '/',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      // 소스에서 직접 임포트 — 빌드 없이 개발 가능
      '@loykin/dashboardkit/react': resolve(__dirname, '../src/react.ts'),
      '@loykin/dashboardkit/url-state': resolve(__dirname, '../src/adapters/url-state.ts'),
      '@loykin/dashboardkit/variables': resolve(__dirname, '../src/variables-entrypoint.ts'),
      '@loykin/dashboardkit': resolve(__dirname, '../src/index.ts'),
      '@examples': resolve(__dirname, '../examples/src'),
    },
  },
})

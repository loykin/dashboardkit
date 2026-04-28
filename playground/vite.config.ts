import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      // 소스에서 직접 임포트 — 빌드 없이 개발 가능
      '@dashboard-engine/core/react': resolve(__dirname, '../src/react.ts'),
      '@dashboard-engine/core/url-state': resolve(__dirname, '../src/url-state.ts'),
      '@dashboard-engine/core': resolve(__dirname, '../src/index.ts'),
    },
  },
})

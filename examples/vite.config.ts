import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@loykin/dashboardkit/react': resolve(__dirname, '../src/react.ts'),
      '@loykin/dashboardkit/url-state': resolve(__dirname, '../src/adapters/url-state.ts'),
      '@loykin/dashboardkit/addons': resolve(__dirname, '../src/addons-entrypoint.ts'),
      '@loykin/dashboardkit': resolve(__dirname, '../src/index.ts'),
    },
  },
})

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
      // Import directly from source for local development without a package build.
      '@loykin/dashboardkit/react': resolve(__dirname, '../src/react.ts'),
      '@loykin/dashboardkit/url-state': resolve(__dirname, '../src/adapters/url-state.ts'),
      '@loykin/dashboardkit/variables': resolve(__dirname, '../src/variables-entrypoint.ts'),
      '@loykin/dashboardkit': resolve(__dirname, '../src/index.ts'),
      '@examples': resolve(__dirname, '../examples/src'),
    },
  },
})

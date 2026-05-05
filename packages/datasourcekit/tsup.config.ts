import { defineConfig } from 'tsup'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageDir = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  entry: {
    index: resolve(packageDir, 'src/index.ts'),
  },
  outDir: resolve(packageDir, 'dist'),
  tsconfig: resolve(packageDir, 'tsconfig.json'),
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
})

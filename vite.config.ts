import { defineConfig } from 'vitest/config'

export default defineConfig({
  server: { host: true, port: 5173 },
  build: { target: 'es2022', sourcemap: false },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

// YALC GTM-OS web SPA build.
// Output is consumed by the Hono server at runtime via static-file mount;
// see src/lib/server/index.ts for the mount + SPA fallback logic.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@brand': path.resolve(__dirname, './brand'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      // Forward API calls to the Hono server during dev so the SPA
      // doesn't need its own auth context.
      '/api': {
        target: 'http://localhost:3847',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    target: 'es2020',
    cssCodeSplit: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('react') || id.includes('scheduler')) return 'vendor-react'
            if (id.includes('@radix-ui')) return 'vendor-radix'
            return 'vendor'
          }
        },
      },
    },
  },
})

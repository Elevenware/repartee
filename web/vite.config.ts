import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

const bff = process.env.RP_BFF || 'http://localhost:7080'

export default defineConfig({
  plugins: [vue()],
  base: process.env.VITE_REPARTEE_BASE || '/',
  server: {
    port: 5173,
    proxy: {
      '/api': { target: bff, changeOrigin: false },
      '/callback': { target: bff, changeOrigin: false },
    },
  },
})

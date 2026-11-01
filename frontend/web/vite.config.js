import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// https://vite.dev/config/
export default defineConfig({
  base: process.env.VITE_BASE_PATH || '/ticketing/',
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: process.env.VITE_PORT ? parseInt(process.env.VITE_PORT) : 5005,
    strictPort: true,
    cors: true,
    allowedHosts: true,
    watch: {
      usePolling: true,
      interval: 100,
    },
    proxy: {
      '/api/ticketing/customer': {
        target: process.env.VITE_CUSTOMER_SERVICE_URL || 'http://127.0.0.1:8001',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/api\/ticketing\/customer/, '/api')
      },
      '/api/ticketing/ticket': {
        target: process.env.VITE_TICKET_SERVICE_URL || 'http://127.0.0.1:8002',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/api\/ticketing\/ticket/, '/api')
      },
      '/api/ticketing/employee': {
        target: process.env.VITE_EMPLOYEE_SERVICE_URL || 'http://127.0.0.1:8008',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/api\/ticketing\/employee/, '/api')
      },
      '/api/ticketing/attachment': {
        target: process.env.VITE_ATTACHMENT_SERVICE_URL || 'http://127.0.0.1:8006',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/api\/ticketing\/attachment/, '/api')
      },
      '/api/ticketing/messaging': {
        target: process.env.VITE_MESSAGING_SERVICE_URL || 'http://127.0.0.1:8007',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/api\/ticketing\/messaging/, '/api')
      },
      '/api/ticketing/analytics': {
        target: process.env.VITE_ANALYTICS_SERVICE_URL || 'http://127.0.0.1:8004',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/api\/ticketing\/analytics/, '/api')
      },
      '/api/ticketing/configuration': {
        target: process.env.VITE_CONFIGURATION_SERVICE_URL || 'http://127.0.0.1:8009',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/api\/ticketing\/configuration/, '/api')
      },
      '/api/configuration': {
        target: process.env.VITE_CONFIGURATION_SERVICE_URL || 'http://127.0.0.1:8009',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/api\/configuration/, '/api')
      },
      '/api/analytics': {
        target: process.env.VITE_ANALYTICS_SERVICE_URL || 'http://127.0.0.1:8010',
        changeOrigin: true,
        secure: false,
      },

      '/api/ticketing/ai': {
        target: process.env.VITE_AI_SERVICE_URL || 'http://127.0.0.1:8005',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/api\/ticketing\/ai/, '/api')
      },
      '/storage': {
        target: process.env.VITE_ATTACHMENT_SERVICE_URL || 'http://127.0.0.1:8006',
        changeOrigin: true,
        secure: false,
      }
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  // Ensure these packages are pre-bundled / not externalized by Vite
  optimizeDeps: {
    include: ['laravel-echo', 'pusher-js'],
  },
  ssr: {
    noExternal: ['laravel-echo', 'pusher-js'],
  },
})

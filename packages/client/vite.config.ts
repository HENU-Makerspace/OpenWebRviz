import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

const apiProxyTarget = process.env.VITE_API_PROXY_TARGET || 'http://localhost:4001';
const rosbridgeProxyTarget = process.env.VITE_ROSBRIDGE_PROXY_TARGET || 'ws://localhost:9090';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  define: {
    'process.browser': 'true',
    'process.env': {},
  },
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: apiProxyTarget,
        changeOrigin: true,
      },
      '/rosbridge': {
        target: rosbridgeProxyTarget,
        changeOrigin: true,
        ws: true,
      },
    },
  },
});

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

/**
 * 浏览器调试模式（npm run dev:web）：访问 /index.web.html，
 * 先装 noteDesk 假实现再挂载应用，用于在纯浏览器里调界面样式。
 */
export default defineConfig({
  plugins: [react()],
  root: resolve(__dirname, 'src/renderer'),
});

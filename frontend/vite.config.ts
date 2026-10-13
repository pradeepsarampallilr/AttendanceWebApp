/**
 * Settings for the development server: sends /api requests to the backend and turns on React and styling.
 */
import path from 'node:path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Proxy /api to the backend on whatever PORT it is configured with (backend/.env), default 3000.
export default defineConfig(({ mode }) => {
  const port = loadEnv(mode, path.resolve(process.cwd(), '../backend'), '').PORT || 3000;
  console.log(`[vite] proxying /api -> http://localhost:${port}`);
  return {
    plugins: [react(), tailwindcss()],
    server: { port: 5173, proxy: { '/api': `http://localhost:${port}` } },
  };
});

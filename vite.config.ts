import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  build: { chunkSizeWarningLimit: 1200 },
  server: { port: 5173, strictPort: true, watch: { ignored: ['**/.wsl-build/**', '**/release/**', '**/docs/references/**'] } },
});

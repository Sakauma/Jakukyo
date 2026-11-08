import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: './',
  build: {
    chunkSizeWarningLimit: 1200,
    ...(mode === 'offline' ? {
      assetsInlineLimit: Number.MAX_SAFE_INTEGER,
      cssCodeSplit: false,
      modulePreload: false,
      copyPublicDir: false,
      sourcemap: false,
      rollupOptions: { output: { inlineDynamicImports: true } },
    } : {}),
  },
  server: { port: 5173, strictPort: true, watch: { ignored: ['**/.wsl-build/**', '**/release/**', '**/docs/references/**'] } },
}));

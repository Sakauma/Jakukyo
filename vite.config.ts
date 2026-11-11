import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// mcrRuntime supplies the verified, decompressed WASM bytes before creating a session.
// Suppress ORT's unused default URLs so Vite does not inline the binary again.
const suppliedOrtWasm = () => ({
  name: 'supplied-ort-wasm',
  enforce: 'pre' as const,
  transform(code: string, id: string) {
    if (!id.replaceAll('\\', '/').split('?')[0].endsWith('/onnxruntime-web/dist/ort.wasm.bundle.min.mjs')) return;
    return code.replaceAll('new URL("ort-wasm-simd-threaded.wasm",import.meta.url).href', '"ort-wasm-simd-threaded.wasm"');
  },
});

export default defineConfig(({ mode }) => ({
  plugins: [suppliedOrtWasm(), react()],
  worker: { plugins: () => [suppliedOrtWasm()] },
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

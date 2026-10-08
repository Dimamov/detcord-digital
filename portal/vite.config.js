import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig({
  plugins: [preact()],
  publicDir: 'public',
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: false },
});

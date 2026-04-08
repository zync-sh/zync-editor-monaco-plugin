import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    cssCodeSplit: false,
    assetsInlineLimit: 1024 * 1024 * 20,
    rollupOptions: {
      input: 'src/main.ts',
      output: {
        format: 'iife',
        entryFileNames: 'editor.js',
        assetFileNames: 'editor-[name]-[hash][extname]',
        inlineDynamicImports: true,
      },
    },
  },
});

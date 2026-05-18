import { defineConfig } from 'vite';
import { svelte, vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { viteSingleFile } from 'vite-plugin-singlefile';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    svelte({
      // vitePreprocess handles <script lang="ts"> in .svelte files
      preprocess: vitePreprocess(),
    }),
    viteSingleFile(), // Inline all assets into a single HTML file (needed for Figma)
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: false, // Don't delete code.js on UI rebuild
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
    rollupOptions: {
      input: 'ui.html', // Entry point — outputs dist/ui.html
    },
  },
});

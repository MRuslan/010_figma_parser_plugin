import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

export default {
  // vitePreprocess enables TypeScript, PostCSS, etc. in .svelte files
  preprocess: vitePreprocess(),
};

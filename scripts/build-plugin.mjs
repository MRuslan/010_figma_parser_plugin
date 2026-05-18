/**
 * Build script for the Figma plugin sandbox code (src/plugin/code.ts → dist/code.js)
 * Uses esbuild for fast TypeScript bundling.
 *
 * Usage:
 *   node scripts/build-plugin.mjs           → single build
 *   node scripts/build-plugin.mjs --watch   → watch mode (dev)
 */

import esbuild from 'esbuild';
import { mkdir } from 'fs/promises';
import { existsSync } from 'fs';

const isWatch = process.argv.includes('--watch');

// Ensure dist/ exists
if (!existsSync('dist')) {
  await mkdir('dist', { recursive: true });
}

/** esbuild plugin that logs rebuild time on every change */
const rebuildNotifierPlugin = {
  name: 'rebuild-notifier',
  setup(build) {
    let start;
    build.onStart(() => {
      start = Date.now();
    });
    build.onEnd((result) => {
      const ms = Date.now() - start;
      if (result.errors.length > 0) {
        console.error(`\n❌  Plugin build failed (${ms}ms)`);
      } else {
        const time = new Date().toLocaleTimeString();
        console.log(`\n⚡  [${time}] Plugin rebuilt → dist/code.js (${ms}ms)`);
        console.log('    Reload the plugin in Figma to apply changes.\n');
      }
    });
  },
};

/** @type {import('esbuild').BuildOptions} */
const buildOptions = {
  entryPoints: ['src/plugin/code.ts'],
  bundle: true,
  outfile: 'dist/code.js',
  target: 'es2017',
  format: 'iife', // Figma sandbox expects IIFE or ESM; IIFE is safest
  tsconfig: 'tsconfig.plugin.json',
  logLevel: 'silent', // We handle logging ourselves via the plugin
  plugins: [rebuildNotifierPlugin],
};

if (isWatch) {
  console.log('🔨  Building plugin code (initial build)...');
  const ctx = await esbuild.context(buildOptions);

  // Explicit initial build — ctx.watch() alone does NOT build first
  await ctx.rebuild();

  // Then watch for subsequent changes
  await ctx.watch();
  console.log('👀  Watching src/plugin/ for changes...');
  console.log('    Figma auto-reloads in Development mode when dist/code.js changes.\n');
} else {
  await esbuild.build(buildOptions);
}

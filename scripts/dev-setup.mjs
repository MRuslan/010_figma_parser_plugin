/**
 * Dev setup script — runs before starting the dev server.
 *
 * Writes a proxy dist/ui.html that loads the UI from the Vite dev server
 * (http://localhost:5173) inside an iframe and bridges postMessage between
 * the iframe and Figma. This enables full HMR for the Svelte UI without
 * having to rebuild every time.
 *
 * In production, vite build replaces dist/ui.html with the real built app.
 */

import { mkdir, writeFile } from 'fs/promises';
import { existsSync } from 'fs';

const DEV_PORT = 5173;

if (!existsSync('dist')) {
  await mkdir('dist', { recursive: true });
}

const proxyHTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <style>
    * { margin: 0; padding: 0; }
    body { overflow: hidden; }
    iframe { width: 100vw; height: 100vh; border: none; display: block; }
  </style>
</head>
<body>
  <iframe
    id="dev-frame"
    src="http://localhost:${DEV_PORT}"
    allow="clipboard-write; clipboard-read"
  ></iframe>

  <script>
    var iframe = document.getElementById('dev-frame');

    window.addEventListener('message', function (event) {
      if (event.source === iframe.contentWindow) {
        // Message from Svelte app → forward to Figma
        window.parent.postMessage(event.data, '*');
      } else {
        // Message from Figma → forward to Svelte app
        iframe.contentWindow && iframe.contentWindow.postMessage(event.data, '*');
      }
    });
  </script>
</body>
</html>`;

await writeFile('dist/ui.html', proxyHTML, 'utf-8');

console.log('');
console.log('🔧  Dev proxy written to dist/ui.html');
console.log(`📡  UI will load from http://localhost:${DEV_PORT} (Vite dev server)`);
console.log('📌  In Figma: Plugins → Development → Import plugin from manifest');
console.log('    Select manifest.json from this folder, then run the plugin.');
console.log('');

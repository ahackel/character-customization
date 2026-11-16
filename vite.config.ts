import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

/**
 * The wardrobe's shape editor saves the eye and mouth shapes through the dev server into
 * lab/face-shapes.json, so they are part of the project. Only while developing; the published
 * site has no such endpoint and the editor there cannot save.
 */
function faceShapes(): Plugin {
  const file = fileURLToPath(new URL('./lab/face-shapes.json', import.meta.url));
  const rows = (v: unknown) => Array.isArray(v) && v.length <= 8 && v.every((r) => typeof r === 'string' && r.length <= 12 && /^[.ICTM%]*$/.test(r));
  const valid = (data: any) =>
    data && typeof data === 'object' && ['eyes', 'mouths'].every((k) => data[k] && typeof data[k] === 'object') &&
    Object.values(data.eyes).every((view: any) => Object.values(view).every((shape: any) => Object.values(shape).every(rows))) &&
    Object.values(data.mouths).every((view: any) => Object.values(view).every(rows));
  return {
    name: 'face-shapes',
    configureServer(server) {
      server.middlewares.use('/__face-shapes', (req, res) => {
        if (req.method !== 'POST') return void (res.statusCode = 405, res.end());
        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', () => {
          try {
            const data = JSON.parse(body);
            if (!valid(data)) throw new Error('not face shapes');
            writeFileSync(file, JSON.stringify(data, null, 1) + '\n');
            res.end('ok');
          } catch (error) {
            res.statusCode = 400;
            res.end(String(error));
          }
        });
      });
    },
  };
}

// Relative base so the built site works from any path (static hosting, file previews).
// `vite build` builds every page for local use, the lab included. `vite build --mode site` builds
// the published site (andreashackel.de/pixel-art/): the start page, the wardrobe, the animal editor, the object editor,
// the flora tool and the scene editor.
export default defineConfig(({ mode }) => {
  const site = mode === 'site';
  const pages = { main: 'index.html', wardrobe: 'wardrobe/index.html', animals: 'animals/index.html', objects: 'objects/index.html', flora: 'flora/index.html', scene: 'scene/index.html' };
  return {
    base: './',
    plugins: [faceShapes()],
    build: {
      outDir: site ? 'dist-site' : 'dist',
      chunkSizeWarningLimit: 900,
      rollupOptions: { input: site ? pages : { ...pages, lab: 'lab/index.html' } },
    },
  };
});

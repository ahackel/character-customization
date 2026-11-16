import { defineConfig } from 'vite';

// Relative base so the built site works from any path (static hosting, file previews).
// `vite build` builds every page for local use, the lab included. `vite build --mode site` builds
// the published site (andreashackel.de/pixel-art/): the start page, the wardrobe, the animal editor, the object editor,
// the flora tool and the scene editor.
export default defineConfig(({ mode }) => {
  const site = mode === 'site';
  const pages = { main: 'index.html', wardrobe: 'wardrobe/index.html', animals: 'animals/index.html', objects: 'objects/index.html', flora: 'flora/index.html', scene: 'scene/index.html' };
  return {
    base: './',
    build: {
      outDir: site ? 'dist-site' : 'dist',
      chunkSizeWarningLimit: 900,
      rollupOptions: { input: site ? pages : { ...pages, lab: 'lab/index.html' } },
    },
  };
});

import { defineConfig } from 'vite';

// Relative base so the built site works from any path (static hosting, file previews).
// `vite build` builds every page for local use. `vite build --mode site` builds the published
// site (andreashackel.de/pixel-art/): the start page, the wardrobe and the flora tool, without the
// 3D prototype, its models, or the lab.
export default defineConfig(({ mode }) => {
  const site = mode === 'site';
  const pages = { main: 'index.html', wardrobe: 'wardrobe/index.html', flora: 'flora/index.html' };
  return {
    base: './',
    publicDir: site ? false : 'public',
    build: {
      outDir: site ? 'dist-site' : 'dist',
      chunkSizeWarningLimit: 900,
      rollupOptions: { input: site ? pages : { ...pages, prototype: 'prototype/index.html', lab: 'lab/index.html' } },
    },
  };
});

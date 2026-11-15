import { defineConfig } from 'vite';

// Relative base so the built site works from any path (static hosting, file previews).
export default defineConfig({
  base: './',
  build: {
    chunkSizeWarningLimit: 900,
    // The 3D prototype, the 2D experiments and the 2D wardrobe are separate entries.
    rollupOptions: { input: { main: 'index.html', lab: 'lab/index.html', wardrobe: 'wardrobe/index.html' } },
  },
});

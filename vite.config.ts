import { defineConfig } from 'vite';

// Relative base so the built site works from any path (static hosting, file previews).
export default defineConfig({
  base: './',
  build: {
    chunkSizeWarningLimit: 900,
    // The game prototype and the 2D experiment page are separate entries.
    rollupOptions: { input: { main: 'index.html', lab: 'lab/index.html' } },
  },
});

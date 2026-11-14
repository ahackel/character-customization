import { defineConfig } from 'vite';

// Relative base so the built site works from any path (static hosting, file previews).
export default defineConfig({
  base: './',
  build: { chunkSizeWarningLimit: 900 },
});

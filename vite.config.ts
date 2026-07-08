import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    fs: {
      // The workspace path contains ':' characters, which break Vite's
      // workspace-root detection for the allow list.
      strict: false,
    },
  },
});

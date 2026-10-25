import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Relative base so the build works under https://<user>.github.io/<repo>/ without knowing the repo name.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { chunkSizeWarningLimit: 700 },
});

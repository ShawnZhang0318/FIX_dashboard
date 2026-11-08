import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Railway serves this app at the domain root. GitHub Pages uses a project
  // subpath, configured explicitly in its workflow via VITE_BASE_PATH.
  base: process.env.VITE_BASE_PATH || '/',
  plugins: [react()],
});

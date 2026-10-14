import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/FIX_dashboard/',
  plugins: [react()],
});

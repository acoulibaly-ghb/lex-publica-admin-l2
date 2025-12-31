
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    // Injecte les variables d'environnement système (Vercel) ou locales
    'process.env.API_KEY': JSON.stringify(process.env.API_KEY || process.env.VITE_API_KEY || ''),
    'process.env.TEACHER_PASSWORD': JSON.stringify(process.env.TEACHER_PASSWORD || process.env.VITE_TEACHER_PASSWORD || 'admin'),
  },
});

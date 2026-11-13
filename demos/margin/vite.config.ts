import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ base: './', resolve: { dedupe: ['react', 'react-dom', '@byoagent/browser'] }, plugins: [react()], server: { port: 5183, strictPort: true } });

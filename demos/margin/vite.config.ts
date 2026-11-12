import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ base: './', resolve: { alias: { '@byoagent/browser': new URL('../../byoa-extension/sdk/dist/index.js', import.meta.url).pathname } }, plugins: [react()], server: { port: 5183, strictPort: true } });

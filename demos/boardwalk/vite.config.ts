import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
export default defineConfig({ resolve: { alias: { '@byoagent/browser': fileURLToPath(new URL('../../byoa-extension/sdk/dist/index.js', import.meta.url)) } } });

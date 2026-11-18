import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // @byoagent/react is a local package with its own React install; use this app's copy.
  resolve: { dedupe: ["react", "react-dom"] },
  build: {
    // Keep the audio worklet a real file; addModule should not depend on data: URLs.
    assetsInlineLimit: (file) => (file.endsWith(".worklet.js") ? false : undefined),
  },
  test: {
    globals: true,
  },
});

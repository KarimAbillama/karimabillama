import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Builds the clickable preview; scripts/build-preview.ts then inlines it into one HTML file.
export default defineConfig({
  root: "preview",
  base: "./",
  plugins: [react()],
  build: { outDir: "../dist/preview", emptyOutDir: true, assetsInlineLimit: 100_000_000, cssCodeSplit: false, modulePreload: false },
});

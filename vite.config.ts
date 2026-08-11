import { defineConfig } from "vite";
import { octane } from "octane/compiler/vite";
import tailwindcss from "@tailwindcss/vite";
import electron from "vite-plugin-electron/simple";
import path from "path";

export default defineConfig(async ({ mode }) => ({
  plugins: [
    octane(),
    tailwindcss(),
    ...(mode === "web"
      ? []
      : [
          electron({
            main: {
              entry: {
                main: "electron/main.ts",
                engine: "electron/engine.ts",
              },
              vite: {
                build: {
                  rolldownOptions: {
                    // Runtime packages read builder metadata and load native
                    // files, so their package boundaries must survive bundling.
                    external: ["electron-updater", "@celados/fff-node"],
                  },
                },
              },
            },
            preload: {
              input: "electron/preload.ts",
            },
          }),
        ]),
  ],

  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src/"),
      "@/components": path.resolve(import.meta.dirname, "./src/components/"),
      "@/context": path.resolve(import.meta.dirname, "./src/context/"),
      "@/hooks": path.resolve(import.meta.dirname, "./src/hooks/"),
      "@/lib": path.resolve(import.meta.dirname, "./src/lib/"),
      "@/stores": path.resolve(import.meta.dirname, "./src/stores/"),
      "@/features": path.resolve(import.meta.dirname, "./src/features/"),
    },
  },
  base: "./",
}));

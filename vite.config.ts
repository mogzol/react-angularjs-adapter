import { defineConfig } from "vite";
import dts from "vite-plugin-dts";
import path from "path";

export default defineConfig({
  build: {
    minify: false,
    lib: {
      entry: path.resolve(__dirname, "react-angularjs-adapter.ts"),
      name: "ReactAngularJSAdapter",
      fileName: (format) => `react-angularjs-adapter.${format}.js`,
    },
    rollupOptions: {
      external: ["react", "react-dom", "react-dom/client", "angular"],
      output: {
        globals: {
          react: "React",
          "react-dom": "ReactDOM",
          "react-dom/client": "ReactDOM",
          angular: "angular",
        },
      },
    },
  },
  plugins: [dts({ include: "react-angularjs-adapter.ts" })],
});

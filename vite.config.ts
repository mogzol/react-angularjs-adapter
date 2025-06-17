import { defineConfig } from "vite";
import dts from "vite-plugin-dts";
import path from "path";

export default defineConfig({
  build: {
    minify: false,
    sourcemap: true,
    lib: {
      entry: path.resolve(__dirname, "react-angularjs-adapter.ts"),
      name: "ReactAngularJSAdapter",
      fileName: "react-angularjs-adapter",
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
  plugins: [
    dts({
      include: "react-angularjs-adapter.ts",
      afterDiagnostic: (diagnostics) => {
        if (diagnostics.length) {
          throw new Error("Type checking failed");
        }
      },
    }),
  ],
});

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// PostGraphile answers on :5678; proxying /graphql keeps the page and the API on one origin.
export default defineConfig({
  plugins: [react()],
  server: { proxy: { "/graphql": "http://localhost:5678" } },
});

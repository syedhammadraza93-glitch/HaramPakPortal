import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [tailwindcss(), react()],
    server: {
      port: Number(env.PORT) || 5173,
      proxy: {
        // The API runs from ./server (npm run dev there). Same-origin proxy keeps the refresh cookie first-party.
        "/api": { target: env.VITE_API_URL || "http://localhost:5002", changeOrigin: true, secure: false },
      },
    },
    preview: { host: "0.0.0.0" },
  };
});

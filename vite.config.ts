import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig(() => {
  const isVercel = process.env.VERCEL === "1";
  return {
    plugins: [react()],
    publicDir: isVercel ? (false as const) : "public",
    build: isVercel ? { outDir: "public", emptyOutDir: true } : undefined,
    server: { port: 5173, proxy: { "/api": "http://localhost:8787" } },
  };
});

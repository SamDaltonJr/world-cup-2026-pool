import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base: "./" produces relative asset URLs, which work on GitHub Pages
// project sites (https://<user>.github.io/<repo>/) without hardcoding the
// repo name. Override with VITE_BASE if you host at a custom path/domain.
export default defineConfig({
  base: process.env.VITE_BASE || "./",
  plugins: [react()],
});

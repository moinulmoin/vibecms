import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Local theme harness: `pnpm --filter @vc/content harness`, then open
// /?view=post|index&preset=minimal|editorial|technical|product&mode=light|dark&font=<id>&accent=<id>&layout=standard|essay|feature
export default defineConfig({
  root: __dirname,
  plugins: [react()],
  resolve: { dedupe: ["react", "react-dom"] },
});

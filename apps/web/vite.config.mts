import { defineConfig } from "vite";
import { redwood } from "rwsdk/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  optimizeDeps: {
    include: ["lucide-react"],
    exclude: ["@vc/ui"],
  },
  ssr: {
    noExternal: ["lucide-react"],
  },
  environments: {
    ssr: {
      optimizeDeps: { include: ["lucide-react"], exclude: ["@vc/ui"] },
      resolve: { noExternal: ["lucide-react"] },
    },
    worker: {
      optimizeDeps: { include: ["lucide-react"], exclude: ["@vc/ui"] },
      resolve: { noExternal: ["lucide-react"] },
    },
  },
  plugins: [
    tailwindcss(),
    cloudflare({
      viteEnvironment: { name: "worker" },
    }),
    redwood(),
  ],
});

import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    css: false,
    // Worker-environment tests run via vitest.isolation.config.ts + cloudflarePool.
    // Excluding them here prevents the node runner from importing cloudflare:workers.
    exclude: ['**/node_modules/**', '**/.git/**', 'src/**/*.worker.test.ts'],
  },
});

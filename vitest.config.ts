import { defineConfig } from 'vitest/config';

// Vitest uses its own root rather than inheriting the Vite client root
// (`src/client`), so it can pick up tests anywhere under the repo.
export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts', 'src/**/*.test.ts'],
    environment: 'node',
  },
});

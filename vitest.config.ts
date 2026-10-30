import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['apps/**/*.test.ts', 'packages/**/*.test.ts'],
    // MFA and D1 integration exercise real cryptography and the Worker emulator.
    testTimeout: 15000,
  },
});

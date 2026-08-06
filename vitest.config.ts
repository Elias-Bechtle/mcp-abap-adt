import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Integration tests talk to a real SAP system and are opt-in via RUN_INTEGRATION=1.
    // They live in tests/integration and skip themselves when the flag is absent, so
    // `vitest run` stays green on a machine with no SAP access.
    include: ['tests/**/*.test.ts'],
  },
});

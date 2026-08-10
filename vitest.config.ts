import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Integration tests talk to a real SAP system and are opt-in via RUN_INTEGRATION=1.
    // They live in tests/integration and skip themselves when the flag is absent, so
    // `vitest run` stays green on a machine with no SAP access.
    include: ['tests/**/*.test.ts'],
    // Runs before each test file: keeps the developer's own home directory,
    // and any .mcp-abap-adtrc in it, out of the assertions.
    setupFiles: ['tests/setup/hermeticHome.ts'],
  },
});

import type { ConnectionRegistry } from '../connection/registry.js';
import { return_text, type ToolResult } from '../lib/result.js';

/**
 * Reports the configured systems and any configuration problems. Deliberately
 * does no network or keychain I/O, and never exposes usernames or passwords.
 */
export function handleListSystems(registry: ConnectionRegistry): ToolResult {
  return return_text(
    JSON.stringify(
      {
        defaultSystem: registry.defaultSystem ?? null,
        systems: registry.listSystems(),
        configErrors: registry.configErrors,
      },
      null,
      2,
    ),
  );
}

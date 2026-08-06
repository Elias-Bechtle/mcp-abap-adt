import type { SystemConfig } from '../../config/schema.js';
import type { CredentialProvider } from '../types.js';

export function requireUsername(systemName: string, system: SystemConfig): string {
  if (!system.username) {
    throw new Error(`System "${systemName}" has no "username" configured.`);
  }
  return system.username;
}

/** Password written straight into the configuration file. */
export function createInlineProvider(): CredentialProvider {
  return {
    id: 'inline',
    canResolve: (system) => Boolean(system.password),
    async resolve(systemName, system) {
      return { username: requireUsername(systemName, system), password: system.password! };
    },
  };
}

import type { CredentialProvider } from '../types.js';
import { requireUsername } from './inline.js';

/** Password taken from an environment variable named in the configuration. */
export function createEnvProvider(env: NodeJS.ProcessEnv = process.env): CredentialProvider {
  return {
    id: 'env',
    canResolve: (system) => Boolean(system.passwordEnv),
    async resolve(systemName, system) {
      const variable = system.passwordEnv!;
      const password = env[variable];
      if (!password) {
        throw new Error(
          `System "${systemName}" expects its password in the environment variable ${variable}, which is not set.`,
        );
      }
      return { username: requireUsername(systemName, system), password };
    },
  };
}

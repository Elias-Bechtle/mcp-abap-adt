import type { SystemConfig } from '../config/schema.js';
import { createEnvProvider } from './providers/env.js';
import { createInlineProvider } from './providers/inline.js';
import { createKeychainProvider } from './providers/keychain.js';
import type { CredentialProvider, CredentialSource, ResolvedCredentials } from './types.js';

export interface CredentialProviderOptions {
  env?: NodeJS.ProcessEnv;
  providers?: CredentialProvider[];
}

/**
 * Order matters: an explicitly written password beats an environment
 * reference, which beats the keychain lookup.
 */
export function defaultCredentialProviders(env?: NodeJS.ProcessEnv): CredentialProvider[] {
  return [createInlineProvider(), createEnvProvider(env), createKeychainProvider()];
}

/** Which provider would handle this system, without touching the keychain. */
export function credentialSourceOf(
  system: SystemConfig,
  providers: CredentialProvider[],
): CredentialSource | undefined {
  return providers.find((provider) => provider.canResolve(system))?.id;
}

export async function resolveCredentials(
  systemName: string,
  system: SystemConfig,
  providers: CredentialProvider[],
): Promise<ResolvedCredentials> {
  const provider = providers.find((candidate) => candidate.canResolve(system));
  if (!provider) {
    throw new Error(
      `System "${systemName}" has no credentials configured. Set "keychain": true to use the OS keychain, ` +
        'name an environment variable with "passwordEnv", or (discouraged) set "password" directly.',
    );
  }
  return provider.resolve(systemName, system);
}

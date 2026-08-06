import { FIORI_KEYCHAIN_SERVICE, fioriKeychainId } from '../../config/fiori.js';
import type { CredentialProvider, KeychainBackend, ResolvedCredentials } from '../types.js';

let cachedBackend: Promise<KeychainBackend> | undefined;

/**
 * Loads the native keyring lazily so that installing this server on a platform
 * without a prebuilt binary still works for the inline and env credential
 * paths.
 */
export function loadKeychainBackend(): Promise<KeychainBackend> {
  cachedBackend ??= import('@zowe/secrets-for-zowe-sdk')
    .then((module) => {
      const keyring = module.keyring ?? (module as { default?: { keyring?: unknown } }).default?.keyring;
      if (!keyring) throw new Error('the module did not expose a keyring');
      return keyring as KeychainBackend;
    })
    .catch((error: unknown) => {
      cachedBackend = undefined;
      throw new Error(
        `The OS keychain is unavailable: ${error instanceof Error ? error.message : String(error)}. ` +
          'Use "passwordEnv" instead, or reinstall so the native keyring binary is present.',
      );
    });
  return cachedBackend;
}

/**
 * Interprets what SAP Fiori tools stores: a JSON blob holding only the
 * sensitive fields. A bare string is accepted as the password so a manually
 * created entry still works.
 */
function parseSecret(secret: string): { username?: string; password?: string } {
  try {
    const parsed: unknown = JSON.parse(secret);
    if (parsed && typeof parsed === 'object') {
      const { username, password } = parsed as { username?: unknown; password?: unknown };
      return {
        username: typeof username === 'string' ? username : undefined,
        password: typeof password === 'string' ? password : undefined,
      };
    }
  } catch {
    // not JSON — fall through and treat the whole value as the password
  }
  return { password: secret };
}

/**
 * Reads credentials from the OS keychain using the same service and account
 * naming as the SAP Fiori tools VS Code extension, so a system saved there can
 * be used here without re-entering the password.
 */
export function createKeychainProvider(backendLoader = loadKeychainBackend): CredentialProvider {
  return {
    id: 'keychain',
    canResolve: (system) => system.keychain,
    async resolve(systemName, system): Promise<ResolvedCredentials> {
      const account = fioriKeychainId(system.url, system.client);
      const backend = await backendLoader();
      const secret = await backend.getPassword(FIORI_KEYCHAIN_SERVICE, account);

      if (!secret) {
        throw new Error(
          `No keychain entry for system "${systemName}" (${FIORI_KEYCHAIN_SERVICE} / ${account}). ` +
            `Save the system in the SAP Fiori tools VS Code extension, or run "mcp-abap-adt store-credentials --system ${systemName}".`,
        );
      }

      const stored = parseSecret(secret);
      const username = system.username ?? stored.username;
      if (!username) {
        throw new Error(
          `The keychain entry for system "${systemName}" contains no username. Add "username" to the system configuration.`,
        );
      }
      if (!stored.password) {
        throw new Error(`The keychain entry for system "${systemName}" contains no password.`);
      }
      return { username, password: stored.password };
    },
  };
}

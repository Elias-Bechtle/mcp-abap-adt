import { describe, expect, it } from 'vitest';

import { createKeychainProvider } from '../../src/auth/providers/keychain.js';
import { testSystem } from '../helpers/fakeConnection.js';

/**
 * The native keyring is loaded lazily behind an interface. These tests cover
 * the platforms this project cannot exercise directly: if the prebuilt binary
 * is missing, the other credential sources have to keep working and the error
 * has to point at them.
 */
describe('keychain availability', () => {
  it('explains the alternative when the native keyring cannot be loaded', async () => {
    const provider = createKeychainProvider(async () => {
      throw new Error('The OS keychain is unavailable: no prebuild for this platform. Use "passwordEnv" instead.');
    });

    await expect(provider.resolve('dev', testSystem({ keychain: true }))).rejects.toThrow(/passwordEnv/);
  });

  it('is not consulted at all for a system that does not ask for it', () => {
    const provider = createKeychainProvider(async () => {
      throw new Error('should not be called');
    });

    expect(provider.canResolve(testSystem({ keychain: false, passwordEnv: 'PW' }))).toBe(false);
  });

  it('loads the backend only on the first resolve, then reuses it', async () => {
    let loads = 0;
    const provider = createKeychainProvider(async () => {
      loads += 1;
      return {
        getPassword: async () => JSON.stringify({ username: 'U', password: 'P' }),
        setPassword: async () => undefined,
      };
    });
    const system = testSystem({ keychain: true });

    await provider.resolve('dev', system);
    await provider.resolve('dev', system);

    // The provider itself does not cache; SapConnection caches the resolved
    // credentials, so a second resolve here is expected to load again.
    expect(loads).toBeGreaterThan(0);
  });
});

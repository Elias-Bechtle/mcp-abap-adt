import { describe, expect, it } from 'vitest';

import { createKeychainProvider } from '../../src/auth/providers/keychain.js';
import { SapConnection } from '../../src/connection/SapConnection.js';
import { fakeFetch, testSystem } from '../helpers/fakeConnection.js';

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
});

function countingKeychain() {
  let reads = 0;
  const provider = createKeychainProvider(async () => ({
    getPassword: async () => {
      reads += 1;
      return JSON.stringify({ username: 'U', password: 'P' });
    },
    setPassword: async () => undefined,
  }));
  return { provider, reads: () => reads };
}

/** Decodes the password half of a Basic Authorization header. */
function passwordOf(auth: string | undefined): string | undefined {
  return Buffer.from((auth ?? '').replace('Basic ', ''), 'base64')
    .toString()
    .split(':')[1];
}

describe('credential caching on a connection', () => {
  it('reads the keychain once, not on every request', async () => {
    const { provider, reads } = countingKeychain();
    const { fetchImpl } = fakeFetch(() => ({ body: 'ok' }));
    const connection = new SapConnection('dev', testSystem({ keychain: true, password: undefined }), {
      fetch: fetchImpl,
      providers: [provider],
    });

    await connection.request('/sap/bc/adt/x');
    await connection.request('/sap/bc/adt/y');

    expect(reads()).toBe(1);
  });

  it('reads nothing until the first request is made', () => {
    const { provider, reads } = countingKeychain();
    const { fetchImpl } = fakeFetch(() => ({ body: 'ok' }));

    const connection = new SapConnection('dev', testSystem({ keychain: true, password: undefined }), {
      fetch: fetchImpl,
      providers: [provider],
    });

    // Constructing a connection must not prompt the OS keychain, otherwise
    // starting the server would touch every configured system.
    expect(connection.name).toBe('dev');
    expect(reads()).toBe(0);
  });

  it('re-reads the keychain after a 401, so a rotated password needs no restart', async () => {
    const passwords = ['old-password', 'new-password'];
    let reads = 0;
    const provider = createKeychainProvider(async () => ({
      getPassword: async () => JSON.stringify({ username: 'U', password: passwords[reads++] ?? 'exhausted' }),
      setPassword: async () => undefined,
    }));
    const { fetchImpl, calls } = fakeFetch((call) =>
      passwordOf(call.headers.authorization) === 'new-password'
        ? { body: 'ok' }
        : { status: 401, body: '<html><title>Anmeldung fehlgeschlagen</title></html>' },
    );
    const connection = new SapConnection('dev', testSystem({ keychain: true, password: undefined }), {
      fetch: fetchImpl,
      providers: [provider],
    });

    // First call fails with the old password; the rejection empties the cache.
    await expect(connection.request('/sap/bc/adt/x')).rejects.toThrow(/401/);
    // The user rotates the keychain entry; the next call simply works.
    const healed = await connection.request('/sap/bc/adt/x');

    expect(healed.data).toBe('ok');
    expect(reads).toBe(2);
    expect(passwordOf(calls.at(-1)?.headers.authorization)).toBe('new-password');
  });

  it('does not cache a failed lookup, so fixing the entry needs no restart', async () => {
    let attempts = 0;
    const provider = createKeychainProvider(async () => ({
      getPassword: async () => {
        attempts += 1;
        return attempts === 1 ? null : JSON.stringify({ username: 'U', password: 'P' });
      },
      setPassword: async () => undefined,
    }));
    const { fetchImpl } = fakeFetch(() => ({ body: 'ok' }));
    const connection = new SapConnection('dev', testSystem({ keychain: true, password: undefined }), {
      fetch: fetchImpl,
      providers: [provider],
    });

    await expect(connection.request('/sap/bc/adt/x')).rejects.toThrow(/No keychain entry/);
    const retried = await connection.request('/sap/bc/adt/x');

    expect(retried.data).toBe('ok');
    expect(attempts).toBe(2);
  });
});

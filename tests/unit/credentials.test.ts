import { describe, expect, it, vi } from 'vitest';

import { createEnvProvider } from '../../src/auth/providers/env.js';
import { createInlineProvider } from '../../src/auth/providers/inline.js';
import { createKeychainProvider } from '../../src/auth/providers/keychain.js';
import { credentialSourceOf, resolveCredentials } from '../../src/auth/resolve.js';
import type { KeychainBackend } from '../../src/auth/types.js';
import { SystemConfigSchema, type SystemConfig } from '../../src/config/schema.js';

function system(overrides: Partial<SystemConfig> = {}): SystemConfig {
  return SystemConfigSchema.parse({
    url: 'https://sap.example.com:44300',
    client: '100',
    ...overrides,
  });
}

function fakeKeychain(entries: Record<string, string>): KeychainBackend {
  return {
    getPassword: vi.fn(async (_service: string, account: string) => entries[account] ?? null),
    setPassword: vi.fn(async () => undefined),
  };
}

describe('inline provider', () => {
  it('uses the password from the configuration', async () => {
    const provider = createInlineProvider();
    const cfg = system({ username: 'DEVELOPER', password: 'secret' });

    expect(provider.canResolve(cfg)).toBe(true);
    await expect(provider.resolve('dev', cfg)).resolves.toEqual({
      username: 'DEVELOPER',
      password: 'secret',
    });
  });

  it('refuses to guess a missing username', async () => {
    const provider = createInlineProvider();

    await expect(provider.resolve('dev', system({ password: 'secret' }))).rejects.toThrow(/no "username"/);
  });
});

describe('env provider', () => {
  it('reads the password from the named variable', async () => {
    const provider = createEnvProvider({ SAP_DEV_PASSWORD: 'from-env' });
    const cfg = system({ username: 'DEVELOPER', passwordEnv: 'SAP_DEV_PASSWORD' });

    await expect(provider.resolve('dev', cfg)).resolves.toEqual({
      username: 'DEVELOPER',
      password: 'from-env',
    });
  });

  it('names the variable that is missing', async () => {
    const provider = createEnvProvider({});
    const cfg = system({ username: 'DEVELOPER', passwordEnv: 'SAP_DEV_PASSWORD' });

    await expect(provider.resolve('dev', cfg)).rejects.toThrow(/SAP_DEV_PASSWORD, which is not set/);
  });
});

describe('keychain provider', () => {
  const account = 'https://sap.example.com:44300/100';

  it('reads the SAP Fiori tools JSON secret', async () => {
    const backend = fakeKeychain({
      [account]: JSON.stringify({ username: 'DI0190', password: 'kc-secret' }),
    });
    const provider = createKeychainProvider(async () => backend);

    await expect(provider.resolve('dev', system({ keychain: true }))).resolves.toEqual({
      username: 'DI0190',
      password: 'kc-secret',
    });
    expect(backend.getPassword).toHaveBeenCalledWith('fiori/v2/system', account);
  });

  it('lets the configured username override the stored one', async () => {
    const backend = fakeKeychain({
      [account]: JSON.stringify({ username: 'STORED', password: 'kc-secret' }),
    });
    const provider = createKeychainProvider(async () => backend);

    await expect(provider.resolve('dev', system({ keychain: true, username: 'OVERRIDE' }))).resolves.toMatchObject({
      username: 'OVERRIDE',
    });
  });

  it('treats a non-JSON secret as a bare password', async () => {
    const backend = fakeKeychain({ [account]: 'plain-password' });
    const provider = createKeychainProvider(async () => backend);

    await expect(provider.resolve('dev', system({ keychain: true, username: 'DEVELOPER' }))).resolves.toEqual({
      username: 'DEVELOPER',
      password: 'plain-password',
    });
  });

  it('explains how to create a missing entry', async () => {
    const provider = createKeychainProvider(async () => fakeKeychain({}));

    await expect(provider.resolve('dev', system({ keychain: true }))).rejects.toThrow(/store-credentials --system dev/);
  });

  it('fails clearly when the entry has no username anywhere', async () => {
    const backend = fakeKeychain({ [account]: JSON.stringify({ password: 'kc-secret' }) });
    const provider = createKeychainProvider(async () => backend);

    await expect(provider.resolve('dev', system({ keychain: true }))).rejects.toThrow(/contains no username/);
  });

  it('looks up a system without a client under the bare URL', async () => {
    const backend = fakeKeychain({
      'https://sap.example.com:44300': JSON.stringify({ username: 'U', password: 'P' }),
    });
    const provider = createKeychainProvider(async () => backend);
    const cfg = SystemConfigSchema.parse({ url: 'https://sap.example.com:44300', keychain: true });

    await expect(provider.resolve('dev', cfg)).resolves.toMatchObject({ username: 'U' });
  });
});

describe('provider chain', () => {
  const providers = [
    createInlineProvider(),
    createEnvProvider({ PW: 'from-env' }),
    createKeychainProvider(async () => fakeKeychain({})),
  ];

  it('prefers an inline password over the other sources', async () => {
    const cfg = system({ username: 'U', password: 'inline', passwordEnv: 'PW', keychain: true });

    expect(credentialSourceOf(cfg, providers)).toBe('inline');
    await expect(resolveCredentials('dev', cfg, providers)).resolves.toMatchObject({
      password: 'inline',
    });
  });

  it('prefers an environment reference over the keychain', async () => {
    const cfg = system({ username: 'U', passwordEnv: 'PW', keychain: true });

    expect(credentialSourceOf(cfg, providers)).toBe('env');
    await expect(resolveCredentials('dev', cfg, providers)).resolves.toMatchObject({
      password: 'from-env',
    });
  });

  it('says what to configure when no source applies', async () => {
    const cfg = system({ username: 'U' });

    expect(credentialSourceOf(cfg, providers)).toBeUndefined();
    await expect(resolveCredentials('dev', cfg, providers)).rejects.toThrow(/no credentials configured/);
  });
});

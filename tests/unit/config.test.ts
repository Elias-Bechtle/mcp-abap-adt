import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadAppConfig } from '../../src/config/load.js';
import { fioriKeychainId } from '../../src/config/fiori.js';

let workDir: string;
let homeDir: string;

beforeEach(async () => {
  const root = await mkdtemp(join(tmpdir(), 'mcp-abap-adt-'));
  workDir = join(root, 'work');
  homeDir = join(root, 'home');
  await mkdir(workDir);
  await mkdir(homeDir);
});

afterEach(async () => {
  await rm(join(workDir, '..'), { recursive: true, force: true });
});

/** Loads with a hermetic environment so the developer's own SAP_* vars cannot leak in. */
function load(env: NodeJS.ProcessEnv = {}, configFile?: string) {
  return loadAppConfig({ cwd: workDir, homeDir, env, configFile });
}

async function writeConfig(config: unknown): Promise<string> {
  const path = join(workDir, 'mcp-abap-adt.config.json');
  await writeFile(path, JSON.stringify(config), 'utf8');
  return path;
}

/** Mirrors the real layout written by @sap-ux/store: { systems: { "<id>": entry } }. */
async function writeFioriStore(dir: string, systems: unknown): Promise<void> {
  await mkdir(join(homeDir, dir), { recursive: true });
  await writeFile(join(homeDir, dir, 'systems.json'), JSON.stringify({ systems }), 'utf8');
}

const ENV_COMPLETE = {
  SAP_URL: 'https://sap.example.com:44300',
  SAP_USERNAME: 'DEVELOPER',
  SAP_PASSWORD: 'secret',
  SAP_CLIENT: '001',
};

describe('environment fallback', () => {
  it('synthesises a default system from the legacy SAP_* variables', async () => {
    const config = await load(ENV_COMPLETE);

    expect(config.errors).toEqual([]);
    expect(config.defaultSystem).toBe('default');
    expect(config.systems.get('default')).toMatchObject({
      url: 'https://sap.example.com:44300',
      client: '001',
      username: 'DEVELOPER',
      password: 'secret',
      allowSelfSigned: false,
      timeoutMs: 30_000,
    });
  });

  it('honours SAP_LANGUAGE, which older versions ignored', async () => {
    const config = await load({ ...ENV_COMPLETE, SAP_LANGUAGE: 'DE' });

    expect(config.systems.get('default')).toMatchObject({ language: 'DE' });
  });

  it('records that the system came from the environment', async () => {
    const config = await load(ENV_COMPLETE);

    expect(config.systems.get('default')?.origin).toBe('environment');
  });

  it('reports which variables are missing when the set is incomplete', async () => {
    const config = await load({ SAP_URL: 'https://sap.example.com', SAP_USERNAME: 'DEVELOPER' });

    expect(config.systems.size).toBe(0);
    expect(config.errors.map((e) => e.message).join('\n')).toContain('SAP_PASSWORD, SAP_CLIENT');
  });

  it('rejects a malformed URL instead of creating a broken system', async () => {
    const config = await load({ ...ENV_COMPLETE, SAP_URL: 'not-a-url' });

    expect(config.systems.size).toBe(0);
    expect(config.errors.some((e) => e.scope === 'system:default')).toBe(true);
  });

  it('complains when nothing at all is configured', async () => {
    const config = await load();

    expect(config.systems.size).toBe(0);
    expect(config.errors.map((e) => e.message).join('\n')).toContain('No SAP system is configured');
  });
});

describe('allowSelfSigned from the environment', () => {
  it('is off by default, so certificates are verified', async () => {
    const config = await load(ENV_COMPLETE);

    expect(config.systems.get('default')?.allowSelfSigned).toBe(false);
  });

  it('is enabled by SAP_ALLOW_SELF_SIGNED', async () => {
    const values = ['true', '1', 'yes', 'TRUE'];

    const configs = await Promise.all(values.map((value) => load({ ...ENV_COMPLETE, SAP_ALLOW_SELF_SIGNED: value })));

    for (const [index, config] of configs.entries()) {
      expect(config.systems.get('default')?.allowSelfSigned, values[index]).toBe(true);
    }
  });

  it('still accepts the deprecated TLS_REJECT_UNAUTHORIZED with its inverted meaning', async () => {
    const disabled = await load({ ...ENV_COMPLETE, TLS_REJECT_UNAUTHORIZED: '0' });
    expect(disabled.systems.get('default')?.allowSelfSigned).toBe(true);

    const enforced = await load({ ...ENV_COMPLETE, TLS_REJECT_UNAUTHORIZED: '1' });
    expect(enforced.systems.get('default')?.allowSelfSigned).toBe(false);
  });

  it('lets the current variable win over the deprecated one', async () => {
    const config = await load({
      ...ENV_COMPLETE,
      SAP_ALLOW_SELF_SIGNED: 'false',
      TLS_REJECT_UNAUTHORIZED: '0',
    });

    expect(config.systems.get('default')?.allowSelfSigned).toBe(false);
  });

  it('ignores an empty deprecated variable, as shipped in .env.example', async () => {
    const config = await load({ ...ENV_COMPLETE, TLS_REJECT_UNAUTHORIZED: '' });

    expect(config.systems.get('default')?.allowSelfSigned).toBe(false);
  });
});

describe('config file', () => {
  const twoSystems = {
    defaultSystem: 'dev',
    systems: {
      dev: {
        url: 'https://dev.example.com:44300',
        client: '100',
        username: 'DEV_USER',
        keychain: true,
      },
      prd: {
        url: 'https://prd.example.com:44300',
        client: '200',
        username: 'PRD_USER',
        keychain: true,
      },
    },
  };

  it('loads multiple named systems and the declared default', async () => {
    await writeConfig(twoSystems);
    const config = await load();

    expect(config.errors).toEqual([]);
    expect([...config.systems.keys()].toSorted()).toEqual(['dev', 'prd']);
    expect(config.defaultSystem).toBe('dev');
  });

  it('is found through an explicit path as well', async () => {
    const path = await writeConfig(twoSystems);
    const config = await loadAppConfig({ cwd: homeDir, homeDir, env: {}, configFile: path });

    expect([...config.systems.keys()].toSorted()).toEqual(['dev', 'prd']);
  });

  it('keeps the healthy systems when one entry is malformed', async () => {
    await writeConfig({
      systems: {
        good: { url: 'https://good.example.com', client: '100' },
        broken: { url: 'https://broken.example.com', client: 'XX' },
      },
    });
    const config = await load();

    expect([...config.systems.keys()]).toEqual(['good']);
    expect(config.errors).toHaveLength(1);
    expect(config.errors[0].scope).toBe('system:broken');
  });

  it('reports an unknown defaultSystem but still serves the configured ones', async () => {
    await writeConfig({
      defaultSystem: 'nope',
      systems: { dev: { url: 'https://dev.example.com', client: '100' } },
    });
    const config = await load();

    expect(config.errors.map((e) => e.message).join('\n')).toContain('defaultSystem "nope"');
    // Exactly one system remains, so it is an unambiguous default.
    expect(config.defaultSystem).toBe('dev');
  });

  it('lets a configured "default" system win over the SAP_* variables', async () => {
    await writeConfig({ systems: { default: { url: 'https://file.example.com', client: '100' } } });
    const config = await load(ENV_COMPLETE);

    expect(config.systems.get('default')?.url).toBe('https://file.example.com');
    expect(config.errors.map((e) => e.message).join('\n')).toContain('were ignored');
  });

  it('merges file systems and the environment default side by side', async () => {
    await writeConfig({ systems: { dev: { url: 'https://dev.example.com', client: '100' } } });
    const config = await load(ENV_COMPLETE);

    expect([...config.systems.keys()].toSorted()).toEqual(['default', 'dev']);
    expect(config.defaultSystem).toBe('default');
  });
});

describe('SAP Fiori tools discovery', () => {
  const fioriStore = {
    'https://fiori.example.com:44300/100': {
      name: 'FIORI_DEV',
      url: 'https://fiori.example.com:44300',
      client: '100',
      authenticationType: 'basic',
    },
    'https://cloud.example.com': {
      name: 'ABAP_CLOUD',
      url: 'https://cloud.example.com',
      authenticationType: 'reentranceTicket',
    },
  };

  it('imports basic-auth systems and routes them to the keychain', async () => {
    await writeFioriStore('.saptools', fioriStore);
    await writeConfig({ importFioriSystems: true });
    const config = await load();

    expect(config.systems.get('FIORI_DEV')).toMatchObject({
      url: 'https://fiori.example.com:44300',
      client: '100',
      keychain: true,
    });
  });

  it('skips authentication types it cannot handle and says why', async () => {
    await writeFioriStore('.saptools', fioriStore);
    await writeConfig({ importFioriSystems: true });
    const config = await load();

    expect(config.systems.has('ABAP_CLOUD')).toBe(false);
    expect(config.errors.map((e) => e.message).join('\n')).toContain('reentranceTicket');
  });

  it('prefers .saptools over the legacy .fioritools location', async () => {
    await writeFioriStore('.fioritools', {
      a: { name: 'SHARED', url: 'https://legacy.example.com', client: '100' },
    });
    await writeFioriStore('.saptools', {
      a: { name: 'SHARED', url: 'https://current.example.com', client: '100' },
    });
    await writeConfig({ importFioriSystems: true });
    const config = await load();

    expect(config.systems.get('SHARED')?.url).toBe('https://current.example.com');
  });

  it('marks imported systems with their origin', async () => {
    await writeFioriStore('.saptools', fioriStore);
    await writeConfig({ importFioriSystems: true });
    const config = await load();

    expect(config.systems.get('FIORI_DEV')?.origin).toBe('fiori-tools');
  });

  it('lets a config entry override single settings without repeating the system', async () => {
    await writeFioriStore('.saptools', {
      a: { name: 'FIORI_DEV', url: 'https://fiori.example.com', client: '100' },
    });
    // Only the one setting that differs; url and client stay imported.
    await writeConfig({ importFioriSystems: true, systems: { FIORI_DEV: { allowSelfSigned: true } } });
    const config = await load();

    expect(config.errors).toEqual([]);
    expect(config.systems.get('FIORI_DEV')).toMatchObject({
      url: 'https://fiori.example.com',
      client: '100',
      keychain: true,
      allowSelfSigned: true,
      origin: 'fiori-tools',
    });
  });

  it('keeps the imported system when an override is invalid, and says so', async () => {
    await writeFioriStore('.saptools', {
      a: { name: 'FIORI_DEV', url: 'https://fiori.example.com', client: '100' },
    });
    await writeConfig({ importFioriSystems: true, systems: { FIORI_DEV: { client: 'nope' } } });
    const config = await load();

    // Losing access to the system over a typo in one setting would be worse
    // than ignoring the override.
    expect(config.systems.get('FIORI_DEV')).toMatchObject({ client: '100' });
    expect(config.errors.map((e) => e.message).join('\n')).toContain('was ignored, the imported settings are used');
  });

  it('still requires a url for a system that was not imported', async () => {
    await writeConfig({ importFioriSystems: true, systems: { ORPHAN: { allowSelfSigned: true } } });
    const config = await load();

    expect(config.systems.has('ORPHAN')).toBe(false);
    expect(config.errors.map((e) => e.message).join('\n')).toContain('Invalid system "ORPHAN"');
  });

  it('lets a fully declared config entry replace an imported one', async () => {
    await writeFioriStore('.saptools', {
      a: { name: 'FIORI_DEV', url: 'https://fiori.example.com', client: '100' },
    });
    await writeConfig({
      importFioriSystems: true,
      systems: { FIORI_DEV: { url: 'https://override.example.com', client: '200' } },
    });
    const config = await load();

    expect(config.systems.get('FIORI_DEV')).toMatchObject({
      url: 'https://override.example.com',
      client: '200',
    });
  });

  it('stays quiet when the store does not exist', async () => {
    await writeConfig({
      importFioriSystems: true,
      systems: { dev: { url: 'https://dev.example.com', client: '100' } },
    });
    const config = await load();

    expect(config.errors).toEqual([]);
    expect([...config.systems.keys()]).toEqual(['dev']);
  });

  it('ignores a corrupt store file rather than failing the whole load', async () => {
    await mkdir(join(homeDir, '.saptools'), { recursive: true });
    await writeFile(join(homeDir, '.saptools', 'systems.json'), '{ not json', 'utf8');
    await writeConfig({
      importFioriSystems: true,
      systems: { dev: { url: 'https://dev.example.com', client: '100' } },
    });
    const config = await load();

    expect(config.errors).toEqual([]);
    expect([...config.systems.keys()]).toEqual(['dev']);
  });

  it('also accepts a store without the "systems" wrapper', async () => {
    await mkdir(join(homeDir, '.saptools'), { recursive: true });
    await writeFile(
      join(homeDir, '.saptools', 'systems.json'),
      JSON.stringify({
        'https://flat.example.com/100': {
          name: 'FLAT',
          url: 'https://flat.example.com',
          client: '100',
        },
      }),
      'utf8',
    );
    await writeConfig({ importFioriSystems: true });
    const config = await load();

    expect(config.systems.get('FLAT')?.url).toBe('https://flat.example.com');
  });

  it('is off unless requested', async () => {
    await writeFioriStore('.saptools', fioriStore);
    await writeConfig({ systems: { dev: { url: 'https://dev.example.com', client: '100' } } });
    const config = await load();

    expect([...config.systems.keys()]).toEqual(['dev']);
  });
});

describe('fioriKeychainId', () => {
  it('matches the id scheme used by @sap-ux/store', () => {
    expect(fioriKeychainId('https://sap.example.com:44300', '100')).toBe('https://sap.example.com:44300/100');
    expect(fioriKeychainId('https://sap.example.com:44300/', '100')).toBe('https://sap.example.com:44300/100');
    expect(fioriKeychainId('  https://sap.example.com  ')).toBe('https://sap.example.com');
  });
});

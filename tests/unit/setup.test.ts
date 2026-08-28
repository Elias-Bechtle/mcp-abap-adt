import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { setup } from '../../src/cli/setup.js';
import type { CliIo } from '../../src/cli/storeCredentials.js';

let workDir: string;
let rcDir: string;
let teamFile: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'mcp-abap-adt-setup-'));
  rcDir = join(workDir, 'home');
  await rm(rcDir, { recursive: true, force: true });
  await (await import('node:fs/promises')).mkdir(rcDir, { recursive: true });
  teamFile = join(workDir, 'team-systems.jsonc');
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

const TEAM = {
  defaultSystem: 'dev',
  systems: {
    dev: { url: 'https://dev.example.com', client: '100', keychain: true },
    qas: { url: 'https://qas.example.com', client: '200', keychain: true },
  },
};

function scriptedIo(answers: { line?: string[]; secret?: string[]; yesNo?: boolean[] } = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const io: CliIo = {
    line: async () => answers.line?.shift() ?? '',
    secret: async () => answers.secret?.shift() ?? '',
    yesNo: async () => answers.yesNo?.shift() ?? false,
    out: (text) => void out.push(text),
    err: (text) => void err.push(text),
  };
  return { io, out: () => out.join(''), err: () => err.join('') };
}

function fakeBackend() {
  const store = new Map<string, string>();
  return {
    store,
    backend: {
      getPassword: async (_service: string, account: string) => store.get(account) ?? null,
      setPassword: async (_service: string, account: string, secret: string) => void store.set(account, secret),
    },
  };
}

describe('setup --from', () => {
  it('onboards a fresh machine: rc file plus one password for all systems', async () => {
    // JSONC on purpose - the shared file should be allowed to carry comments.
    await writeFile(teamFile, `{\n  // our landscape\n  ${JSON.stringify(TEAM).slice(1)}`, 'utf8');
    const { backend, store } = fakeBackend();
    const { io, out } = scriptedIo({ line: ['TEAM_USER'], secret: ['pw'], yesNo: [true] });

    const code = await setup({ from: teamFile }, { io, backend, rcDir });

    expect(code).toBe(0);
    const rc = await readFile(join(rcDir, '.mcp-abap-adtrc'), 'utf8');
    expect(rc).toContain('defaultSystem="dev"');
    expect(rc).toContain('systems.dev.url="https://dev.example.com"');
    expect(rc).toContain('systems.qas.client="200"');
    // One password, two keychain entries, Fiori account convention.
    expect(JSON.parse(store.get('https://dev.example.com/100') ?? '')).toEqual({
      username: 'TEAM_USER',
      password: 'pw',
    });
    expect(store.has('https://qas.example.com/200')).toBe(true);
    expect(existsSync(join(rcDir, '.mcp-abap-adtrc.bak'))).toBe(false);
    expect(out()).toContain('added:');
    expect(out()).toContain('doctor');
  });

  it('keeps local settings on re-run and leaves a .bak behind', async () => {
    await writeFile(teamFile, JSON.stringify(TEAM), 'utf8');
    await writeFile(
      join(rcDir, '.mcp-abap-adtrc'),
      'defaultSystem="qas"\nsystems.dev.url="https://dev.example.com"\nsystems.dev.allowSelfSigned=true\n',
      'utf8',
    );
    const { backend } = fakeBackend();
    const { io } = scriptedIo();

    const code = await setup({ from: teamFile, skipCredentials: true }, { io, backend, rcDir });

    expect(code).toBe(0);
    const rc = await readFile(join(rcDir, '.mcp-abap-adtrc'), 'utf8');
    // The user's own default and their TLS exception survive the team list.
    expect(rc).toContain('defaultSystem="qas"');
    expect(rc).toContain('systems.dev.allowSelfSigned=true');
    expect(rc).toContain('systems.qas.url="https://qas.example.com"');
    expect(existsSync(join(rcDir, '.mcp-abap-adtrc.bak'))).toBe(true);
  });

  it('refuses anything that is not data', async () => {
    const tsFile = join(workDir, 'team.ts');
    await writeFile(tsFile, 'export default {}', 'utf8');
    const { io, err } = scriptedIo();

    const code = await setup({ from: tsFile }, { io, backend: fakeBackend().backend, rcDir });

    expect(code).toBe(2);
    expect(err()).toContain('data, not code');
  });

  it('refuses a team file that wants to extend other files', async () => {
    await writeFile(teamFile, JSON.stringify({ extends: ['github:evil/repo'], ...TEAM }), 'utf8');
    const { io, err } = scriptedIo();

    const code = await setup({ from: teamFile }, { io, backend: fakeBackend().backend, rcDir });

    expect(code).toBe(2);
    expect(err()).toContain('self-contained');
  });

  it('rejects an invalid team file with the offending field named', async () => {
    await writeFile(teamFile, JSON.stringify({ systems: { dev: { url: 'not-a-url' } } }), 'utf8');
    const { io, err } = scriptedIo();

    const code = await setup({ from: teamFile }, { io, backend: fakeBackend().backend, rcDir });

    expect(code).toBe(2);
    expect(err()).toContain('dev');
  });

  it('skips the keychain entirely with --skip-credentials', async () => {
    await writeFile(teamFile, JSON.stringify(TEAM), 'utf8');
    const { backend, store } = fakeBackend();
    const { io } = scriptedIo();

    const code = await setup({ from: teamFile, skipCredentials: true }, { io, backend, rcDir });

    expect(code).toBe(0);
    expect(store.size).toBe(0);
  });

  it('explains itself without --from', async () => {
    const { io, err } = scriptedIo();

    const code = await setup({}, { io, backend: fakeBackend().backend, rcDir });

    expect(code).toBe(2);
    expect(err()).toContain('Usage:');
    expect(err()).toContain('no secrets');
  });
});

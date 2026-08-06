import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { storeCredentials } from '../../src/cli/storeCredentials.js';

let workDir: string;
let configFile: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'mcp-abap-adt-cli-'));
  configFile = join(workDir, 'config.json');
  await writeFile(
    configFile,
    JSON.stringify({ systems: { dev: { url: 'https://dev.example.com', client: '100' } } }),
    'utf8',
  );
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(workDir, { recursive: true, force: true });
});

function captureStderr() {
  const written: string[] = [];
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
    written.push(String(chunk));
    return true;
  });
  return written;
}

describe('store-credentials argument handling', () => {
  it('prints usage and the known systems when --system is missing', async () => {
    const stderr = captureStderr();

    const code = await storeCredentials({ configFile });

    expect(code).toBe(2);
    expect(stderr.join('')).toContain('Usage: mcp-abap-adt store-credentials --system <name>');
    expect(stderr.join('')).toContain('dev');
  });

  it('rejects an unknown system before touching the keychain', async () => {
    const stderr = captureStderr();

    const code = await storeCredentials({ system: 'nope', configFile });

    expect(code).toBe(2);
    expect(stderr.join('')).toContain('Unknown system "nope"');
  });
});

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { HERMETIC_HOME } from '../setup/hermeticHome.js';

const run = promisify(execFile);
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const entryPoint = join(repoRoot, 'dist', 'index.js');

/**
 * The unit tests cover each command's flow with injected dependencies; what
 * they cannot cover is the dispatch itself - that `doctor` and `setup` as
 * positionals actually reach their modules through the built entry point.
 */
const built = existsSync(entryPoint);

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'mcp-abap-adt-cli-e2e-'));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

async function runCli(args: string[]) {
  try {
    const { stdout, stderr } = await run(process.execPath, [entryPoint, ...args], {
      cwd: workDir,
      env: {
        PATH: process.env.PATH ?? '',
        SystemRoot: process.env.SystemRoot ?? '',
        HOME: HERMETIC_HOME,
        USERPROFILE: HERMETIC_HOME,
        XDG_CONFIG_HOME: HERMETIC_HOME,
        // Blanked for the reason stdio.test.ts sets out at length: the .env
        // that index.ts loads sits beside the package, so neither the home
        // redirect nor this temporary cwd keeps a developer's real SAP
        // credentials out of the child - but a variable that is already set
        // does, because loadEnvFile never overwrites one.
        SAP_URL: '',
        SAP_USERNAME: '',
        SAP_PASSWORD: '',
        SAP_CLIENT: '',
      },
      timeout: 30_000,
    });
    return { code: 0, output: stdout + stderr };
  } catch (error) {
    const failed = error as { code?: number; stdout?: string; stderr?: string };
    return { code: failed.code ?? -1, output: `${failed.stdout ?? ''}${failed.stderr ?? ''}` };
  }
}

describe.skipIf(!built)('CLI dispatch through the built entry point', () => {
  it('doctor reports an empty configuration readably and exits with 1', async () => {
    const { code, output } = await runCli(['doctor']);

    expect(code).toBe(1);
    expect(output).toContain('No SAP system is configured');
    expect(output).toContain('finding');
  });

  it('setup without --from prints usage and exits with 2', async () => {
    const { code, output } = await runCli(['setup']);

    expect(code).toBe(2);
    expect(output).toContain('Usage: mcp-abap-adt setup --from');
  });

  it('store-credentials without arguments prints usage naming the bulk mode', async () => {
    const { code, output } = await runCli(['store-credentials']);

    expect(code).toBe(2);
    expect(output).toContain('--all');
  });
});

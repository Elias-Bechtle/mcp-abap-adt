import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { loadConfig } from 'c12';
import { defu } from 'defu';
import { parse as parseRc, serialize as serializeRc } from 'rc9';

import { loadKeychainBackend } from '../auth/providers/keychain.js';
import { AppConfigFileSchema, SystemConfigSchema, type ResolvedSystem } from '../config/schema.js';
import { defaultIo, storeBulk, type CliDeps } from './storeCredentials.js';

export interface SetupOptions {
  /** Path to the shared team list (.json or .jsonc). */
  from?: string;
  username?: string;
  skipCredentials?: boolean;
}

export interface SetupDeps extends CliDeps {
  /** Directory holding the rc file; tests point this at a scratch directory. */
  rcDir?: string;
}

/** The same resolution rc9 uses when c12 reads the file back. */
function defaultRcDir(): string {
  return process.env.XDG_CONFIG_HOME || homedir();
}

/**
 * Onboarding as one command: read a shared team list, fold it into the
 * user-level rc file, and store the credentials for everything in it - so a
 * new team member runs `setup --from <file>` once instead of clicking six
 * systems together and being asked six times for the same password.
 *
 * Returns the process exit code.
 */
export async function setup(options: SetupOptions, deps: SetupDeps = {}): Promise<number> {
  const io = deps.io ?? defaultIo;

  if (!options.from) {
    io.err(
      'Usage: mcp-abap-adt setup --from <path to shared systems file> [--username <user>] [--skip-credentials]\n' +
        'The file holds the same object a config file does ("systems", optional "defaultSystem") and no secrets.\n',
    );
    return 2;
  }

  const from = resolve(options.from);
  // Data only, never code: a shared file gets edited by whoever can push to
  // the team repo, and .ts configs execute on load. The same reasoning bans
  // `extends`, which can pull further files from anywhere.
  const extension = extname(from).toLowerCase();
  if (extension !== '.json' && extension !== '.jsonc') {
    io.err(
      `The team file must be .json or .jsonc, not "${extension || '(none)'}": a shared file must be data, not code.\n`,
    );
    return 2;
  }
  if (!existsSync(from)) {
    io.err(`No file at ${from}.\n`);
    return 2;
  }

  const loaded = await loadConfig({
    configFile: from,
    rcFile: false,
    dotenv: false,
    globalRc: false,
    packageJson: false,
    extend: false,
  });
  const raw = (loaded.config ?? {}) as Record<string, unknown>;
  if ('extends' in raw) {
    io.err('The team file must be self-contained; "extends" is not followed.\n');
    return 2;
  }

  const parsed = AppConfigFileSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    io.err(`The team file is invalid: ${issues}\n`);
    return 2;
  }
  const team = parsed.data;
  // The app config tolerates single malformed systems so one typo cannot take
  // a running server down. A team file is different: it is authored once for
  // everyone, so a broken entry is rejected here, before it spreads.
  const teamSystems: Array<[string, ResolvedSystem]> = [];
  for (const [name, value] of Object.entries(team.systems)) {
    const system = SystemConfigSchema.safeParse(value);
    if (!system.success) {
      const issues = system.error.issues
        .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join('; ');
      io.err(`The team file is invalid - system "${name}": ${issues}\n`);
      return 2;
    }
    teamSystems.push([name, { ...system.data, origin: 'config-file' }]);
  }
  if (teamSystems.length === 0) {
    io.err('The team file holds no systems.\n');
    return 2;
  }

  // Fold into the rc file, with everything local winning: a personal
  // allowSelfSigned or defaultSystem must survive re-running setup after the
  // team list changed.
  const rcDir = deps.rcDir ?? defaultRcDir();
  const rcPath = join(rcDir, '.mcp-abap-adtrc');
  let existing: Record<string, unknown> = {};
  let hadRc = false;
  try {
    existing = parseRc(await readFile(rcPath, 'utf8'));
    hadRc = true;
  } catch {
    // no rc file yet - the normal case on a fresh machine
  }

  const merged = defu(existing, {
    ...(team.defaultSystem ? { defaultSystem: team.defaultSystem } : {}),
    systems: team.systems,
  });

  if (hadRc) {
    // The rc file is hand-editable state; a re-run must never cost the user
    // their own edits without a way back.
    await copyFile(rcPath, `${rcPath}.bak`);
  }
  await writeFile(rcPath, serializeRc(merged), 'utf8');

  const existingSystems = new Set(Object.keys((existing.systems as Record<string, unknown> | undefined) ?? {}));
  const added = teamSystems.filter(([name]) => !existingSystems.has(name)).map(([name]) => name);
  const kept = teamSystems.filter(([name]) => existingSystems.has(name)).map(([name]) => name);
  io.out(`Wrote ${rcPath}${hadRc ? ` (previous version in ${rcPath}.bak)` : ''}.\n`);
  if (added.length > 0) io.out(`  added:               ${added.join(', ')}\n`);
  if (kept.length > 0) io.out(`  kept local settings: ${kept.join(', ')}\n`);

  if (!options.skipCredentials) {
    const targets = teamSystems.filter(([, system]) => system.keychain);
    if (targets.length > 0) {
      const backend = deps.backend ?? (await loadKeychainBackend());
      const code = await storeBulk(targets, { username: options.username }, backend, io);
      if (code !== 0) return code;
    }
  }

  io.out(
    '\nDone. Point your MCP client at: npx -y @janfr/mcp-abap-adt\n' +
      'Check the result with:        npx -y @janfr/mcp-abap-adt doctor\n',
  );
  return 0;
}

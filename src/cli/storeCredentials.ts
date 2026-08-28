import { loadKeychainBackend } from '../auth/providers/keychain.js';
import type { KeychainBackend } from '../auth/types.js';
import { FIORI_KEYCHAIN_SERVICE, fioriKeychainId } from '../config/fiori.js';
import { loadAppConfig } from '../config/load.js';
import type { ResolvedSystem } from '../config/schema.js';
import { promptLine, promptSecret, promptYesNo } from './prompt.js';

/**
 * The terminal, as an interface. The CLI commands take it injected so their
 * flows are testable without a TTY; production code never passes it.
 */
export interface CliIo {
  line(question: string): Promise<string>;
  secret(question: string): Promise<string>;
  yesNo(question: string, defaultYes?: boolean): Promise<boolean>;
  out(text: string): void;
  err(text: string): void;
}

export const defaultIo: CliIo = {
  line: promptLine,
  secret: promptSecret,
  yesNo: promptYesNo,
  out: (text) => void process.stdout.write(text),
  err: (text) => void process.stderr.write(text),
};

export interface CliDeps {
  backend?: KeychainBackend;
  io?: CliIo;
}

export interface StoreCredentialsOptions {
  system?: string;
  /** Comma-separated subset for the bulk mode. */
  systems?: string;
  /** Bulk mode over every system configured for the keychain. */
  all?: boolean;
  username?: string;
  configFile?: string;
}

/** Reads the username out of an existing entry, tolerating the bare-string form. */
async function existingUsername(backend: KeychainBackend, account: string): Promise<string | undefined> {
  const secret = await backend.getPassword(FIORI_KEYCHAIN_SERVICE, account);
  if (!secret) return undefined;
  try {
    const parsed: unknown = JSON.parse(secret);
    const username = (parsed as { username?: unknown } | null)?.username;
    return typeof username === 'string' ? username : undefined;
  } catch {
    return undefined;
  }
}

export interface CredentialEntry {
  systemName: string;
  account: string;
  username: string;
}

/** Writes entries in the Fiori tools format, so both tools keep sharing them. */
export async function writeCredentialEntries(
  entries: CredentialEntry[],
  password: string,
  backend: KeychainBackend,
): Promise<void> {
  await Promise.all(
    entries.map((entry) =>
      backend.setPassword(
        FIORI_KEYCHAIN_SERVICE,
        entry.account,
        JSON.stringify({ username: entry.username, password }),
      ),
    ),
  );
}

/**
 * Asks once, writes everywhere. The point of the bulk mode: landscapes with a
 * central user administration rotate one password across all systems, and
 * updating six keychain entries one by one was the reported pain.
 */
export async function storeBulk(
  targets: Array<[string, ResolvedSystem]>,
  options: StoreCredentialsOptions,
  backend: KeychainBackend,
  io: CliIo,
): Promise<number> {
  const planned: CredentialEntry[] = [];
  const missing: Array<{ systemName: string; account: string }> = [];
  const seenUsernames = new Map<string, number>();

  const resolved = await Promise.all(
    targets.map(async ([name, system]) => {
      const account = fioriKeychainId(system.url, system.client);
      const username = options.username ?? (await existingUsername(backend, account)) ?? system.username;
      return { name, account, username };
    }),
  );
  for (const { name, account, username } of resolved) {
    if (username) {
      planned.push({ systemName: name, account, username });
      seenUsernames.set(username, (seenUsernames.get(username) ?? 0) + 1);
    } else {
      missing.push({ systemName: name, account });
    }
  }

  if (missing.length > 0) {
    // One question covers all entries that have no username anywhere, with
    // the name the other systems use as the obvious default.
    const common = [...seenUsernames.entries()].toSorted((a, b) => b[1] - a[1])[0]?.[0];
    const asked = await io.line(
      `Username for ${missing.map((entry) => entry.systemName).join(', ')}${common ? ` [${common}]` : ''}: `,
    );
    const username = asked || common;
    if (!username) {
      io.err('A username is required.\n');
      return 2;
    }
    for (const entry of missing) planned.push({ ...entry, username });
  }

  const password = await io.secret(
    `Password (stored for ${planned.length} system${planned.length === 1 ? '' : 's'}): `,
  );
  if (!password) {
    io.err('A password is required.\n');
    return 2;
  }

  io.out('About to write these keychain entries:\n');
  for (const entry of planned) {
    io.out(`  ${entry.systemName}  ->  ${entry.username} @ ${entry.account}\n`);
  }
  // One confirmation for the whole batch. These are the entries the Fiori
  // tools extension reads too, which is worth being conscious of once - but
  // only once, not per system.
  if (!(await io.yesNo('Write them?', true))) {
    io.out('Left unchanged.\n');
    return 0;
  }

  await writeCredentialEntries(planned, password, backend);
  io.out(
    `Stored one password for ${planned.length} system${planned.length === 1 ? '' : 's'}. Verify with: mcp-abap-adt doctor --login\n`,
  );
  return 0;
}

/**
 * Writes credentials into the OS keychain in the format the SAP Fiori tools
 * VS Code extension uses, so both tools share one entry and no password has
 * to live in a configuration file.
 *
 * Returns the process exit code.
 */
export async function storeCredentials(options: StoreCredentialsOptions, deps: CliDeps = {}): Promise<number> {
  const io = deps.io ?? defaultIo;
  const config = await loadAppConfig({ configFile: options.configFile });

  if (options.all || options.systems) {
    let targets: Array<[string, ResolvedSystem]>;
    if (options.systems) {
      const names = options.systems
        .split(',')
        .map((name) => name.trim())
        .filter(Boolean);
      const unknown = names.filter((name) => !config.systems.has(name));
      if (unknown.length > 0) {
        io.err(
          `Unknown system${unknown.length === 1 ? '' : 's'} ${unknown.join(', ')}. ` +
            `Configured systems: ${[...config.systems.keys()].join(', ') || '(none)'}\n`,
        );
        return 2;
      }
      targets = names.map((name) => [name, config.systems.get(name) as ResolvedSystem]);
    } else {
      // --all means "everything that reads its password from the keychain";
      // systems with inline or env credentials have nothing stored there.
      targets = [...config.systems.entries()].filter(([, system]) => system.keychain);
      if (targets.length === 0) {
        io.err('No system is configured with "keychain": true, so there is nothing to store.\n');
        return 2;
      }
    }
    const backend = deps.backend ?? (await loadKeychainBackend());
    return storeBulk(targets, options, backend, io);
  }

  if (!options.system) {
    io.err(
      `Usage: mcp-abap-adt store-credentials --system <name> [--username <user>]\n` +
        `       mcp-abap-adt store-credentials --all | --systems <a,b,c>   (one password for many systems)\n` +
        `Configured systems: ${[...config.systems.keys()].join(', ') || '(none)'}\n`,
    );
    return 2;
  }

  const system = config.systems.get(options.system);
  if (!system) {
    io.err(
      `Unknown system "${options.system}". Configured systems: ${[...config.systems.keys()].join(', ') || '(none)'}\n`,
    );
    return 2;
  }

  const account = fioriKeychainId(system.url, system.client);
  const backend = deps.backend ?? (await loadKeychainBackend());

  const existing = await backend.getPassword(FIORI_KEYCHAIN_SERVICE, account);
  if (existing) {
    io.out(`An entry already exists for ${account}.\n`);
    // This is the same entry the SAP Fiori tools extension uses, so replacing
    // it silently would change credentials for another tool as well.
    if (!(await io.yesNo('Overwrite it?'))) {
      io.out('Left unchanged.\n');
      return 0;
    }
  }

  const username = options.username ?? system.username ?? (await io.line(`Username for ${options.system}: `));
  if (!username) {
    io.err('A username is required.\n');
    return 2;
  }

  const password = await io.secret(`Password for ${username}@${options.system}: `);
  if (!password) {
    io.err('A password is required.\n');
    return 2;
  }

  await writeCredentialEntries([{ systemName: options.system, account, username }], password, backend);

  io.out(
    `Stored credentials for "${options.system}" in the OS keychain (${FIORI_KEYCHAIN_SERVICE} / ${account}).\n` +
      `Set "keychain": true for that system so the server uses them.\n`,
  );
  return 0;
}

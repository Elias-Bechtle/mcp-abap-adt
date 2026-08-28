import { Agent, fetch as undiciFetch } from 'undici';

import { loadKeychainBackend } from '../auth/providers/keychain.js';
import { FIORI_KEYCHAIN_SERVICE, fioriKeychainId } from '../config/fiori.js';
import { loadAppConfig } from '../config/load.js';
import type { ResolvedSystem } from '../config/schema.js';
import { AdtHttpError, describeTlsFailure, findHttpStatus } from '../connection/errors.js';
import { SapConnection } from '../connection/SapConnection.js';
import { ConnectionRegistry } from '../connection/registry.js';
import { defaultIo, type CliDeps } from './storeCredentials.js';

export interface DoctorOptions {
  configFile?: string;
  /** Additionally make exactly one authenticated request per system. */
  login?: boolean;
}

export interface DoctorDeps extends CliDeps {
  /** Unauthenticated reachability probe; injected in tests. */
  probeFetch?: typeof globalThis.fetch;
  /** Handed to SapConnection for --login; injected in tests. */
  loginFetch?: typeof globalThis.fetch;
}

const PROBE_TIMEOUT_MS = 10_000;

/**
 * Reachability without authentication: a GET carrying no Authorization header
 * cannot be attributed to any user, so it proves host, port and TLS without
 * ever touching a failed-logon counter. Any HTTP status - the 401 challenge
 * above all - counts as reachable.
 */
async function probeReachability(system: ResolvedSystem, probeFetch?: typeof globalThis.fetch): Promise<string> {
  const url = `${new URL(system.url).origin}/sap/bc/adt/discovery`;
  const agent = probeFetch ? undefined : new Agent({ connect: { rejectUnauthorized: !system.allowSelfSigned } });
  try {
    const doFetch = probeFetch ?? (undiciFetch as unknown as typeof globalThis.fetch);
    const response = await doFetch(url, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      ...(agent ? { dispatcher: agent } : {}),
    } as RequestInit);
    return `reachable (${response.status})`;
  } catch (error) {
    const tls = describeTlsFailure(error, 'probe');
    if (tls) {
      const code = /\(([A-Z_]+)\)/u.exec(tls.message)?.[1] ?? 'TLS';
      return `TLS failure (${code}) - consider "allowSelfSigned": true or NODE_USE_SYSTEM_CA=1`;
    }
    return 'unreachable - host down, VPN not connected, or DNS unknown';
  } finally {
    await agent?.close().catch(() => undefined);
  }
}

/** Exactly one authenticated request; a fresh connection never retries a 401. */
async function probeLogin(name: string, system: ResolvedSystem, loginFetch?: typeof globalThis.fetch): Promise<string> {
  const connection = new SapConnection(name, system, loginFetch ? { fetch: loginFetch } : {});
  try {
    await connection.request('/sap/bc/adt/discovery');
    return 'ok';
  } catch (error) {
    if (findHttpStatus(error, 401)) return 'rejected (401) - wrong password or locked user';
    // Column-friendly: the status says enough, the URL is already in the row.
    if (error instanceof AdtHttpError) return `failed (${error.status})`;
    return `failed: ${error instanceof Error ? error.message.slice(0, 40) : String(error)}`;
  } finally {
    await connection.close().catch(() => undefined);
  }
}

function renderTable(headers: string[], rows: string[][]): string {
  const widths = headers.map((header, column) =>
    Math.max(header.length, ...rows.map((row) => (row[column] ?? '').length)),
  );
  const line = (cells: string[]) => cells.map((cell, column) => cell.padEnd(widths[column])).join('  ');
  return [line(headers), line(widths.map((width) => '-'.repeat(width))), ...rows.map(line)].join('\n');
}

/**
 * One table answering the questions that otherwise need four manual checks:
 * which systems exist, where their credentials come from, whether the keychain
 * actually holds an entry, and whether the host is reachable at all.
 *
 * Returns the process exit code: 0 when nothing needs attention.
 */
export async function doctor(options: DoctorOptions = {}, deps: DoctorDeps = {}): Promise<number> {
  const io = deps.io ?? defaultIo;
  const config = await loadAppConfig({ configFile: options.configFile });
  const registry = new ConnectionRegistry(config);
  const listed = registry.listSystems();

  let findings = config.errors.length;

  // The keychain is only consulted for systems that use it, and its absence
  // (no native module) is a finding of its own rather than a crash.
  let backendError: string | undefined;
  const backend = await (async () => {
    if (deps.backend) return deps.backend;
    if (!listed.some((system) => system.credentialSource === 'keychain')) return undefined;
    try {
      return await loadKeychainBackend();
    } catch (error) {
      backendError = error instanceof Error ? error.message : String(error);
      return undefined;
    }
  })();

  const rows = await Promise.all(
    listed.map(async (entry) => {
      const system = config.systems.get(entry.name) as ResolvedSystem;

      let credentialStatus: string = entry.credentialSource ?? 'none';
      if (entry.credentialSource === 'keychain') {
        if (backend) {
          const account = fioriKeychainId(entry.url, entry.client);
          const secret = await backend.getPassword(FIORI_KEYCHAIN_SERVICE, account);
          credentialStatus = secret ? 'keychain ok' : 'keychain entry MISSING';
          if (!secret) findings += 1;
        } else {
          credentialStatus = 'keychain unavailable';
          findings += 1;
        }
      }

      const reach = await probeReachability(system, deps.probeFetch);
      if (!reach.startsWith('reachable')) findings += 1;

      const row = [
        `${entry.name}${entry.isDefault ? ' *' : ''}`,
        entry.url,
        entry.client ?? '',
        entry.origin,
        credentialStatus,
        reach,
      ];

      if (options.login) {
        if (entry.credentialSource && reach.startsWith('reachable')) {
          const login = await probeLogin(entry.name, system, deps.loginFetch);
          if (login !== 'ok') findings += 1;
          row.push(login);
        } else {
          row.push('skipped');
        }
      }
      return row;
    }),
  );

  const headers = ['system', 'url', 'client', 'origin', 'credentials', 'reachability'];
  if (options.login) headers.push('login');

  if (rows.length > 0) {
    io.out(`${renderTable(headers, rows)}\n`);
    io.out('* = default system\n');
  }
  if (backendError) io.out(`\nKeychain: ${backendError}\n`);
  if (config.errors.length > 0) {
    io.out('\nConfiguration problems:\n');
    for (const error of config.errors) io.out(`  [${error.scope}] ${error.message}\n`);
  }
  if (!options.login && rows.length > 0) {
    io.out('\nCredentials were not tested; add --login for exactly one logon attempt per system.\n');
  }

  io.out(findings === 0 ? '\nEverything checks out.\n' : `\n${findings} finding${findings === 1 ? '' : 's'}.\n`);
  return findings === 0 ? 0 : 1;
}

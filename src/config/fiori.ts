import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { logDebug } from '../lib/log.js';
import { type ConfigError, type SystemConfig, SystemConfigSchema } from './schema.js';

/**
 * Keychain service name used by @sap-ux/store, the library behind the SAP
 * Fiori tools VS Code extension. The "v2" is a storage format version and is
 * unrelated to the package version.
 */
export const FIORI_KEYCHAIN_SERVICE = 'fiori/v2/system';

/**
 * Account name under which Fiori tools stores a system's secret, mirroring
 * BackendSystemKey.getId(): the URL without a trailing slash, optionally
 * suffixed with `/<client>`.
 */
export function fioriKeychainId(url: string, client?: string): string {
  const normalizedUrl = url.trim().replace(/\/$/, '');
  const normalizedClient = client?.trim();
  return normalizedClient ? `${normalizedUrl}/${normalizedClient}` : normalizedUrl;
}

/** Newest directory first — an entry in .saptools supersedes the legacy one. */
const STORE_DIRECTORIES = ['.fioritools', '.saptools'] as const;
const STORE_FILE = 'systems.json';

interface RawFioriSystem {
  name?: unknown;
  url?: unknown;
  client?: unknown;
  authenticationType?: unknown;
}

export interface FioriDiscoveryResult {
  systems: Map<string, SystemConfig>;
  errors: ConfigError[];
  sources: string[];
}

/**
 * The store writes `{ "systems": { "<url>[/<client>]": entry } }`. Older
 * layouts and a plain array are tolerated so a format change degrades into
 * "no systems found" rather than a crash.
 */
function extractEntries(parsed: unknown): RawFioriSystem[] | undefined {
  if (Array.isArray(parsed)) return parsed as RawFioriSystem[];
  if (!parsed || typeof parsed !== 'object') return undefined;

  const record = parsed as Record<string, unknown>;
  const container =
    record.systems && typeof record.systems === 'object' ? (record.systems as Record<string, unknown>) : record;

  return Object.values(container).filter(
    (value): value is RawFioriSystem => Boolean(value) && typeof value === 'object',
  );
}

async function readStoreFile(path: string): Promise<RawFioriSystem[] | undefined> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    return undefined;
  }
  try {
    return extractEntries(JSON.parse(raw));
  } catch {
    logDebug(`ignoring unparsable Fiori tools store at ${path}`);
    return undefined;
  }
}

/**
 * Adopts systems saved by the SAP Fiori tools VS Code extension. Only the
 * non-secret metadata is read here; credentials stay in the OS keychain and
 * are fetched lazily on the first request.
 */
export async function discoverFioriSystems(home: string = homedir()): Promise<FioriDiscoveryResult> {
  const systems = new Map<string, SystemConfig>();
  const errors: ConfigError[] = [];
  const sources: string[] = [];

  const stores = await Promise.all(
    STORE_DIRECTORIES.map(async (dir) => {
      const path = join(home, dir, STORE_FILE);
      return { path, entries: await readStoreFile(path) };
    }),
  );

  for (const { path, entries } of stores) {
    if (!entries) continue;
    sources.push(path);

    for (const entry of entries) {
      const name = typeof entry?.name === 'string' ? entry.name.trim() : '';
      const url = typeof entry?.url === 'string' ? entry.url : '';
      if (!name || !url) continue;

      const authenticationType = entry.authenticationType;
      if (typeof authenticationType === 'string' && authenticationType !== 'basic') {
        errors.push({
          scope: `system:${name}`,
          message: `Fiori tools system "${name}" uses authenticationType "${authenticationType}", which this server does not support yet. Only "basic" is implemented.`,
        });
        continue;
      }

      const client = typeof entry.client === 'string' && entry.client.trim() ? entry.client.trim() : undefined;
      const parsed = SystemConfigSchema.safeParse({ url, client, authType: 'basic', keychain: true });
      if (!parsed.success) {
        errors.push({
          scope: `system:${name}`,
          message: `Fiori tools system "${name}" could not be imported: ${parsed.error.issues
            .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
            .join('; ')}`,
        });
        continue;
      }
      systems.set(name, parsed.data);
    }
  }

  return { systems, errors, sources };
}

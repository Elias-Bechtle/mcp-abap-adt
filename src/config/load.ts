import { loadConfig } from 'c12';

import { logWarn } from '../lib/log.js';
import { discoverFioriSystems } from './fiori.js';
import {
  AppConfigFileSchema,
  type ConfigError,
  type ResolvedAppConfig,
  type SystemConfig,
  SystemConfigSchema,
} from './schema.js';

/** Base name c12 uses to find mcp-abap-adt.config.{ts,jsonc,yaml,...} and rc files. */
export const CONFIG_NAME = 'mcp-abap-adt';

/** Name of the system synthesised from the legacy SAP_* environment variables. */
export const ENV_SYSTEM_NAME = 'default';

const ENV_KEYS = ['SAP_URL', 'SAP_USERNAME', 'SAP_PASSWORD', 'SAP_CLIENT'] as const;

export interface LoadAppConfigOptions {
  cwd?: string;
  /** Explicit config file path; also read from MCP_ABAP_ADT_CONFIG. */
  configFile?: string;
  env?: NodeJS.ProcessEnv;
  /** Home directory to search for the Fiori tools store (tests override this). */
  homeDir?: string;
}

function formatIssues(error: { issues: Array<{ path: PropertyKey[]; message: string }> }): string {
  return error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; ');
}

/**
 * Loads the server configuration from (in order of precedence) an explicit
 * config file, c12's discovered config layers, the SAP Fiori tools store and
 * the legacy SAP_* environment variables.
 *
 * This function never throws. A stdio MCP server that dies before the
 * handshake surfaces in clients as an opaque "server failed to start", so
 * every problem is collected in `errors` instead and reported through the
 * ListSystems tool and stderr.
 */
export async function loadAppConfig(options: LoadAppConfigOptions = {}): Promise<ResolvedAppConfig> {
  const env = options.env ?? process.env;
  const errors: ConfigError[] = [];
  const sources: string[] = [];
  const systems = new Map<string, SystemConfig>();

  let rawConfig: unknown = {};
  try {
    const loaded = await loadConfig({
      name: CONFIG_NAME,
      cwd: options.cwd,
      configFile: options.configFile ?? env.MCP_ABAP_ADT_CONFIG,
      dotenv: true,
      globalRc: true,
    });
    rawConfig = loaded.config ?? {};
    for (const layer of loaded.layers ?? []) {
      if (layer.configFile) sources.push(layer.configFile);
    }
  } catch (error) {
    errors.push({
      scope: 'global',
      message: `Could not read the configuration file: ${error instanceof Error ? error.message : String(error)}`,
    });
  }

  const appParsed = AppConfigFileSchema.safeParse(rawConfig);
  const app = appParsed.success
    ? appParsed.data
    : { defaultSystem: undefined, importFioriSystems: false, systems: {} };
  if (!appParsed.success) {
    errors.push({ scope: 'global', message: `Invalid configuration file: ${formatIssues(appParsed.error)}` });
  }

  for (const [name, value] of Object.entries(app.systems)) {
    const parsed = SystemConfigSchema.safeParse(value);
    if (!parsed.success) {
      errors.push({ scope: `system:${name}`, message: `Invalid system "${name}": ${formatIssues(parsed.error)}` });
      continue;
    }
    systems.set(name, parsed.data);
    if (parsed.data.password) {
      logWarn(
        `system "${name}" has a plaintext password in the configuration file. Prefer "passwordEnv" or "keychain": true.`,
      );
    }
  }

  if (app.importFioriSystems) {
    const discovered = await discoverFioriSystems(options.homeDir);
    errors.push(...discovered.errors);
    sources.push(...discovered.sources);
    for (const [name, system] of discovered.systems) {
      // An explicitly configured system always wins over an imported one.
      if (!systems.has(name)) systems.set(name, system);
    }
  }

  applyEnvFallback({ env, systems, errors, sources });

  const defaultSystem = resolveDefaultSystem(app.defaultSystem, systems, errors);

  if (systems.size === 0) {
    errors.push({
      scope: 'global',
      message:
        'No SAP system is configured. Create an mcp-abap-adt.config.jsonc file with a "systems" entry, set "importFioriSystems": true to adopt systems saved by the SAP Fiori tools VS Code extension, or set SAP_URL, SAP_USERNAME, SAP_PASSWORD and SAP_CLIENT.',
    });
  }

  return { defaultSystem, systems, errors, sources };
}

function applyEnvFallback(ctx: {
  env: NodeJS.ProcessEnv;
  systems: Map<string, SystemConfig>;
  errors: ConfigError[];
  sources: string[];
}): void {
  const { env, systems, errors, sources } = ctx;
  const present = ENV_KEYS.filter((key) => env[key]);
  if (present.length === 0) return;

  if (present.length < ENV_KEYS.length) {
    const missing = ENV_KEYS.filter((key) => !env[key]);
    errors.push({
      scope: 'global',
      message: `Incomplete SAP_* environment configuration, missing: ${missing.join(', ')}. Set all of ${ENV_KEYS.join(', ')} or configure systems in a config file.`,
    });
    return;
  }

  if (systems.has(ENV_SYSTEM_NAME)) {
    errors.push({
      scope: 'global',
      message: `The SAP_* environment variables were ignored because a system named "${ENV_SYSTEM_NAME}" is already configured.`,
    });
    return;
  }

  // TLS_REJECT_UNAUTHORIZED and SAP_LANGUAGE were documented but never read by
  // earlier versions; honour them here so the documentation becomes true.
  const tlsSetting = env.TLS_REJECT_UNAUTHORIZED?.trim().toLowerCase();
  const parsed = SystemConfigSchema.safeParse({
    url: env.SAP_URL,
    client: env.SAP_CLIENT,
    language: env.SAP_LANGUAGE || undefined,
    username: env.SAP_USERNAME,
    password: env.SAP_PASSWORD,
    allowSelfSigned: tlsSetting === '0' || tlsSetting === 'false',
  });

  if (!parsed.success) {
    errors.push({
      scope: `system:${ENV_SYSTEM_NAME}`,
      message: `Invalid SAP_* environment configuration: ${formatIssues(parsed.error)}`,
    });
    return;
  }

  systems.set(ENV_SYSTEM_NAME, parsed.data);
  sources.push('SAP_* environment variables');
}

function resolveDefaultSystem(
  configured: string | undefined,
  systems: Map<string, SystemConfig>,
  errors: ConfigError[],
): string | undefined {
  if (configured) {
    if (systems.has(configured)) return configured;
    errors.push({
      scope: 'global',
      message: `defaultSystem "${configured}" is not a configured system. Known systems: ${[...systems.keys()].join(', ') || '(none)'}.`,
    });
  }
  if (systems.has(ENV_SYSTEM_NAME)) return ENV_SYSTEM_NAME;
  if (systems.size === 1) return [...systems.keys()][0];
  return undefined;
}

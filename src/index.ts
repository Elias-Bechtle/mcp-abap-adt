#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import { loadAppConfig } from './config/load.js';
import { ConnectionRegistry } from './connection/registry.js';
import { logWarn } from './lib/log.js';
import { createServer } from './server.js';

/**
 * Earlier versions read a .env file sitting next to the installed package.
 * c12 loads the one in the working directory; keep the old location working
 * for source installs that already have it.
 */
function loadPackageEnvFile(): void {
  const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  try {
    process.loadEnvFile(path.join(packageRoot, '.env'));
  } catch {
    // absent, which is the normal case
  }
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    options: { config: { type: 'string' }, system: { type: 'string' }, username: { type: 'string' } },
    allowPositionals: true,
    strict: false,
  });

  loadPackageEnvFile();
  const configFile = values.config as string | undefined;

  // A subcommand means this is an interactive run, not an MCP session.
  if (positionals[0] === 'store-credentials') {
    const { storeCredentials } = await import('./cli/storeCredentials.js');
    process.exitCode = await storeCredentials({
      system: values.system as string | undefined,
      username: values.username as string | undefined,
      configFile,
    });
    return;
  }

  const config = await loadAppConfig({ configFile });
  for (const error of config.errors) {
    logWarn(`${error.scope}: ${error.message}`);
  }

  const registry = new ConnectionRegistry(config);
  const server = createServer(registry);

  // The server starts even with a broken configuration. Dying before the MCP
  // handshake would only show up in clients as an opaque startup failure,
  // whereas ListSystems can explain what is actually wrong.
  await server.connect(new StdioServerTransport());

  const shutdown = async () => {
    await registry.closeAll().catch(() => undefined);
    await server.close().catch(() => undefined);
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

const isEntryPoint =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntryPoint) {
  main().catch((error: unknown) => {
    logWarn(`fatal: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}

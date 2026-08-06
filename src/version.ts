import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SERVER_NAME = 'mcp-abap-adt';

/**
 * Reported to MCP clients. Read from package.json so it cannot drift from the
 * published version the way the previously hardcoded "0.1.0" had.
 */
function readVersion(): string {
  try {
    const packageJson = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
    const parsed = JSON.parse(readFileSync(packageJson, 'utf8')) as { version?: string };
    return parsed.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export const SERVER_VERSION = readVersion();

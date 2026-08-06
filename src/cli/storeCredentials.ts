import { loadKeychainBackend } from '../auth/providers/keychain.js';
import { loadAppConfig } from '../config/load.js';
import { FIORI_KEYCHAIN_SERVICE, fioriKeychainId } from '../config/fiori.js';
import { promptLine, promptSecret, promptYesNo } from './prompt.js';

export interface StoreCredentialsOptions {
  system?: string;
  username?: string;
  configFile?: string;
}

/**
 * Writes a system's credentials into the OS keychain in the format the SAP
 * Fiori tools VS Code extension uses, so both tools share one entry and no
 * password has to live in a configuration file.
 *
 * Returns the process exit code.
 */
export async function storeCredentials(options: StoreCredentialsOptions): Promise<number> {
  const config = await loadAppConfig({ configFile: options.configFile });

  if (!options.system) {
    process.stderr.write(
      `Usage: mcp-abap-adt store-credentials --system <name> [--username <user>]\n` +
        `Configured systems: ${[...config.systems.keys()].join(', ') || '(none)'}\n`,
    );
    return 2;
  }

  const system = config.systems.get(options.system);
  if (!system) {
    process.stderr.write(
      `Unknown system "${options.system}". Configured systems: ${[...config.systems.keys()].join(', ') || '(none)'}\n`,
    );
    return 2;
  }

  const account = fioriKeychainId(system.url, system.client);
  const keychain = await loadKeychainBackend();

  const existing = await keychain.getPassword(FIORI_KEYCHAIN_SERVICE, account);
  if (existing) {
    process.stdout.write(`An entry already exists for ${account}.\n`);
    // This is the same entry the SAP Fiori tools extension uses, so replacing
    // it silently would change credentials for another tool as well.
    if (!(await promptYesNo('Overwrite it?'))) {
      process.stdout.write('Left unchanged.\n');
      return 0;
    }
  }

  const username = options.username ?? system.username ?? (await promptLine(`Username for ${options.system}: `));
  if (!username) {
    process.stderr.write('A username is required.\n');
    return 2;
  }

  const password = await promptSecret(`Password for ${username}@${options.system}: `);
  if (!password) {
    process.stderr.write('A password is required.\n');
    return 2;
  }

  await keychain.setPassword(FIORI_KEYCHAIN_SERVICE, account, JSON.stringify({ username, password }));

  process.stdout.write(
    `Stored credentials for "${options.system}" in the OS keychain (${FIORI_KEYCHAIN_SERVICE} / ${account}).\n` +
      `Set "keychain": true for that system so the server uses them.\n`,
  );
  return 0;
}

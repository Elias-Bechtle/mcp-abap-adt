import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadAppConfig } from '../../src/config/load.js';
import { ConnectionRegistry } from '../../src/connection/registry.js';
import type { SapConnection } from '../../src/connection/SapConnection.js';

import { handleGetProgram } from '../../src/handlers/handleGetProgram.js';
import { handleGetClass } from '../../src/handlers/handleGetClass.js';
import { handleGetFunctionGroup } from '../../src/handlers/handleGetFunctionGroup.js';
import { handleGetFunction } from '../../src/handlers/handleGetFunction.js';
import { handleGetTable } from '../../src/handlers/handleGetTable.js';
import { handleGetStructure } from '../../src/handlers/handleGetStructure.js';
import { handleGetTableContents } from '../../src/handlers/handleGetTableContents.js';
import { handleGetPackage } from '../../src/handlers/handleGetPackage.js';
import { handleGetInclude } from '../../src/handlers/handleGetInclude.js';
import { handleGetTypeInfo } from '../../src/handlers/handleGetTypeInfo.js';
import { handleGetInterface } from '../../src/handlers/handleGetInterface.js';
import { handleGetTransaction } from '../../src/handlers/handleGetTransaction.js';
import { handleSearchObject } from '../../src/handlers/handleSearchObject.js';
import type { ToolResult } from '../../src/lib/result.js';

/**
 * These tests talk to a real SAP system using the ambient configuration.
 * They are opt-in so that `npm test` stays green without SAP access:
 *
 *   RUN_INTEGRATION=1 npm test          (bash)
 *   $env:RUN_INTEGRATION='1'; npm test  (PowerShell)
 *
 * Set INTEGRATION_SYSTEM to target a specific configured system.
 */
const runLive = process.env.RUN_INTEGRATION === '1';

let registry: ConnectionRegistry;
let connection: SapConnection;

function expectTextResult(result: ToolResult) {
  expect(result.content[0]?.text).toBeTruthy();
  expect(result.isError).toBe(false);
  expect(result.content[0].type).toBe('text');
}

describe.skipIf(!runLive)('live ADT integration', () => {
  beforeAll(async () => {
    // The hermetic-home setup hides the developer's real configuration from
    // the unit tests; this suite exists to use it, so it takes it back.
    const { AMBIENT_HOME_ENV } = await import('../setup/hermeticHome.js');
    for (const [name, value] of Object.entries(AMBIENT_HOME_ENV)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    const config = await loadAppConfig();
    for (const error of config.errors) console.error(`${error.scope}: ${error.message}`);
    registry = new ConnectionRegistry(config);
    connection = registry.get(process.env.INTEGRATION_SYSTEM);
  });

  afterAll(async () => {
    await registry?.closeAll();
  });

  it('retrieves a program', async () => {
    expectTextResult(await handleGetProgram(connection, { program_name: 'RSABAPPROGRAM' }));
  });

  it('retrieves a class', async () => {
    expectTextResult(await handleGetClass(connection, { class_name: 'CL_WB_PGEDITOR_INITIAL_SCREEN' }));
  });

  it('retrieves a function group', async () => {
    expectTextResult(await handleGetFunctionGroup(connection, { function_group: 'WBABAP' }));
  });

  it('retrieves a function module', async () => {
    expectTextResult(
      await handleGetFunction(connection, {
        function_name: 'WB_PGEDITOR_INITIAL_SCREEN',
        function_group: 'WBABAP',
      }),
    );
  });

  it('retrieves a table', async () => {
    expectTextResult(await handleGetTable(connection, { table_name: 'DD02L' }));
  });

  it('retrieves a structure', async () => {
    expectTextResult(await handleGetStructure(connection, { structure_name: 'SYST' }));
  });

  it('retrieves a package', async () => {
    expectTextResult(await handleGetPackage(connection, { package_name: 'SABP_TYPES' }));
  });

  it('retrieves an include', async () => {
    expectTextResult(await handleGetInclude(connection, { include_name: 'LWBABAPF00' }));
  });

  it('retrieves type info', async () => {
    expectTextResult(await handleGetTypeInfo(connection, { type_name: 'SYST_SUBRC' }));
  });

  it('retrieves an interface', async () => {
    expectTextResult(await handleGetInterface(connection, { interface_name: 'IF_T100_MESSAGE' }));
  });

  it('searches for an object', async () => {
    expectTextResult(await handleSearchObject(connection, { query: 'SYST' }));
  });

  it('retrieves a transaction', async () => {
    expectTextResult(await handleGetTransaction(connection, { transaction_name: 'SE93' }));
  });

  // Exercises the CSRF token and cookie round trip, which no GET-only test covers.
  it('retrieves table contents', async () => {
    expectTextResult(await handleGetTableContents(connection, { table_name: 'DD02L', max_rows: 5 }));
  });

  // A field report claimed the freestyle endpoint rejects joins with "only one
  // SELECT statement is allowed". Reproduction against a current release shows
  // joins with tilde notation work; the report's system presumably differs.
  it('runs a join through the sql console', async () => {
    const { handleExecuteQuery } = await import('../../src/handlers/handleExecuteQuery.js');
    const result = await handleExecuteQuery(connection, {
      query: 'SELECT e070~trkorr, e071~obj_name FROM e070 INNER JOIN e071 ON e070~trkorr = e071~trkorr',
      maxRows: 3,
    });
    expectTextResult(result);
    expect(result.content[0].text).toContain('TRKORR');
  });
});

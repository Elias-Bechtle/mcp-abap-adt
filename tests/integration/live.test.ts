import { describe, expect, it } from 'vitest';

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

/**
 * These tests talk to a real SAP system using the ambient SAP_* configuration.
 * They are opt-in so that `npm test` stays green without SAP access:
 *
 *   RUN_INTEGRATION=1 npm test          (bash)
 *   $env:RUN_INTEGRATION='1'; npm test  (PowerShell)
 */
const runLive = process.env.RUN_INTEGRATION === '1';

function expectTextResult(result: { isError?: boolean; content: Array<{ type: string }> }) {
  expect(result.isError).toBe(false);
  expect(Array.isArray(result.content)).toBe(true);
  expect(result.content.length).toBeGreaterThan(0);
  expect(result.content[0].type).toBe('text');
}

describe.skipIf(!runLive)('live ADT integration', () => {
  it('retrieves a program', async () => {
    expectTextResult(await handleGetProgram({ program_name: 'RSABAPPROGRAM' }));
  });

  it('retrieves a class', async () => {
    expectTextResult(await handleGetClass({ class_name: 'CL_WB_PGEDITOR_INITIAL_SCREEN' }));
  });

  it('retrieves a function group', async () => {
    expectTextResult(await handleGetFunctionGroup({ function_group: 'WBABAP' }));
  });

  it('retrieves a function module', async () => {
    expectTextResult(
      await handleGetFunction({ function_name: 'WB_PGEDITOR_INITIAL_SCREEN', function_group: 'WBABAP' }),
    );
  });

  it('retrieves a table', async () => {
    expectTextResult(await handleGetTable({ table_name: 'DD02L' }));
  });

  it('retrieves a structure', async () => {
    expectTextResult(await handleGetStructure({ structure_name: 'SYST' }));
  });

  it('retrieves a package', async () => {
    expectTextResult(await handleGetPackage({ package_name: 'SABP_TYPES' }));
  });

  it('retrieves an include', async () => {
    expectTextResult(await handleGetInclude({ include_name: 'LWBABAPF00' }));
  });

  it('retrieves type info', async () => {
    expectTextResult(await handleGetTypeInfo({ type_name: 'SYST_SUBRC' }));
  });

  it('retrieves an interface', async () => {
    expectTextResult(await handleGetInterface({ interface_name: 'IF_T100_MESSAGE' }));
  });

  it('searches for an object', async () => {
    expectTextResult(await handleSearchObject({ query: 'SYST' }));
  });

  it('retrieves a transaction', async () => {
    expectTextResult(await handleGetTransaction({ transaction_name: 'SE93' }));
  });

  // Exercises the CSRF-token + cookie round trip, which no GET-only test covers.
  it('retrieves table contents', async () => {
    expectTextResult(await handleGetTableContents({ table_name: 'DD02L', max_rows: 5 }));
  });
});

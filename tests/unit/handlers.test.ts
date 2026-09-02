import { describe, expect, it } from 'vitest';

import type { SapConnection } from '../../src/connection/SapConnection.js';
import type { ToolResult } from '../../src/lib/result.js';
import { fakeConnection, type FakeResponse, type RecordedCall } from '../helpers/fakeConnection.js';

import { handleExecuteQuery } from '../../src/handlers/handleExecuteQuery.js';
import { handleGetBehaviorDefinition } from '../../src/handlers/handleGetBehaviorDefinition.js';
import { handleGetCDSView } from '../../src/handlers/handleGetCDSView.js';
import { handleGetClass } from '../../src/handlers/handleGetClass.js';
import { handleGetFunction } from '../../src/handlers/handleGetFunction.js';
import { handleGetFunctionGroup } from '../../src/handlers/handleGetFunctionGroup.js';
import { handleGetInclude } from '../../src/handlers/handleGetInclude.js';
import { handleGetInterface } from '../../src/handlers/handleGetInterface.js';
import { handleGetPackage } from '../../src/handlers/handleGetPackage.js';
import { handleGetProgram } from '../../src/handlers/handleGetProgram.js';
import { handleGetServiceDefinition } from '../../src/handlers/handleGetServiceDefinition.js';
import { handleGetStructure } from '../../src/handlers/handleGetStructure.js';
import { handleGetSystemInfo } from '../../src/handlers/handleGetSystemInfo.js';
import { handleGetTable } from '../../src/handlers/handleGetTable.js';
import { handleGetTableContents } from '../../src/handlers/handleGetTableContents.js';
import { handleGetTransaction } from '../../src/handlers/handleGetTransaction.js';
import { handleGetTypeInfo } from '../../src/handlers/handleGetTypeInfo.js';
import { handleGetWhereUsed } from '../../src/handlers/handleGetWhereUsed.js';
import { handleSearchObject } from '../../src/handlers/handleSearchObject.js';

const OK: FakeResponse = { body: '<source/>' };

function textOf(result: ToolResult): string {
  return result.content[0].text;
}

/** Runs a handler against a connection that answers everything with `OK`. */
async function callHandler(
  invoke: (connection: SapConnection) => Promise<ToolResult>,
  responder: (call: RecordedCall, index: number) => FakeResponse | Error = () => OK,
) {
  const { connection, calls } = fakeConnection(responder);
  const result = await invoke(connection);
  return { result, calls };
}

/**
 * The ADT paths are this server's contract with SAP: a typo in one is not
 * caught by types or by the connection tests, only by a live system. These
 * assertions pin every one of them down.
 */
describe('ADT paths', () => {
  const cases: Array<[string, (connection: SapConnection) => Promise<ToolResult>, string]> = [
    [
      'GetProgram',
      (c) => handleGetProgram(c, { program_name: 'ZFOO' }),
      '/sap/bc/adt/programs/programs/ZFOO/source/main',
    ],
    ['GetClass', (c) => handleGetClass(c, { class_name: 'ZCL_FOO' }), '/sap/bc/adt/oo/classes/ZCL_FOO/source/main'],
    [
      'GetInterface',
      (c) => handleGetInterface(c, { interface_name: 'ZIF_FOO' }),
      '/sap/bc/adt/oo/interfaces/ZIF_FOO/source/main',
    ],
    [
      'GetInclude',
      (c) => handleGetInclude(c, { include_name: 'ZINC' }),
      '/sap/bc/adt/programs/includes/ZINC/source/main',
    ],
    [
      'GetFunctionGroup',
      (c) => handleGetFunctionGroup(c, { function_group: 'ZFG' }),
      '/sap/bc/adt/functions/groups/ZFG/source/main',
    ],
    [
      'GetFunction',
      (c) => handleGetFunction(c, { function_name: 'Z_FM', function_group: 'ZFG' }),
      '/sap/bc/adt/functions/groups/ZFG/fmodules/Z_FM/source/main',
    ],
    [
      'GetStructure',
      (c) => handleGetStructure(c, { structure_name: 'ZST' }),
      '/sap/bc/adt/ddic/structures/ZST/source/main',
    ],
    ['GetTable', (c) => handleGetTable(c, { table_name: 'ZTAB' }), '/sap/bc/adt/ddic/tables/ZTAB/source/main'],
    [
      'GetCDSView',
      (c) => handleGetCDSView(c, { cds_view_name: 'i_currency' }),
      '/sap/bc/adt/ddic/ddl/sources/I_CURRENCY/source/main',
    ],
    ['GetTypeInfo', (c) => handleGetTypeInfo(c, { type_name: 'ZDOM' }), '/sap/bc/adt/ddic/domains/ZDOM/source/main'],
    [
      'GetBehaviorDefinition',
      (c) => handleGetBehaviorDefinition(c, { behavior_definition_name: 'z_ent' }),
      '/sap/bc/adt/bo/behaviordefinitions/Z_ENT/source/main',
    ],
    [
      'GetServiceDefinition',
      (c) => handleGetServiceDefinition(c, { service_definition_name: 'z_srv' }),
      '/sap/bc/adt/ddic/srvd/sources/Z_SRV/source/main',
    ],
  ];

  it.each(cases)('%s requests %s', async (_name, invoke, expectedPath) => {
    const { result, calls } = await callHandler(invoke);

    expect(result.isError).toBe(false);
    expect(calls).toHaveLength(1);
    expect(calls[0].url.pathname).toBe(expectedPath);
    expect(calls[0].method).toBe('GET');
  });

  it('percent-encodes namespaced object names', async () => {
    const { calls } = await callHandler((c) => handleGetClass(c, { class_name: '/DMO/CL_FLIGHT' }));

    expect(calls[0].url.pathname).toBe('/sap/bc/adt/oo/classes/%2FDMO%2FCL_FLIGHT/source/main');
  });
});

describe('GetTable fallback for older systems', () => {
  it('falls back to the structures endpoint on 404', async () => {
    const { result, calls } = await callHandler(
      (c) => handleGetTable(c, { table_name: 'ZTAB' }),
      (call) => (call.url.pathname.includes('/tables/') ? { status: 404, body: 'not found' } : { body: '<struct/>' }),
    );

    expect(result.isError).toBe(false);
    expect(textOf(result)).toBe('<struct/>');
    expect(calls.map((call) => call.url.pathname)).toEqual([
      '/sap/bc/adt/ddic/tables/ZTAB/source/main',
      '/sap/bc/adt/ddic/structures/ZTAB/source/main',
    ]);
  });

  it('does not fall back on other errors', async () => {
    const { result, calls } = await callHandler(
      (c) => handleGetTable(c, { table_name: 'ZTAB' }),
      () => ({ status: 500, body: 'boom' }),
    );

    expect(result.isError).toBe(true);
    expect(calls).toHaveLength(1);
  });
});

describe('RAP endpoints missing on older systems', () => {
  it('explains a 404 for behavior definitions', async () => {
    const { result } = await callHandler(
      (c) => handleGetBehaviorDefinition(c, { behavior_definition_name: 'Z_ENT' }),
      () => ({ status: 404, body: '<exc/>' }),
    );

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('NW 7.54');
    expect(textOf(result)).toContain('Z_ENT');
  });

  it('explains a 404 for service definitions', async () => {
    const { result } = await callHandler(
      (c) => handleGetServiceDefinition(c, { service_definition_name: 'Z_SRV' }),
      () => ({ status: 404, body: '<exc/>' }),
    );

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('NW 7.54');
  });

  it('passes other failures through with the ADT body', async () => {
    const { result } = await callHandler(
      (c) => handleGetServiceDefinition(c, { service_definition_name: 'Z_SRV' }),
      () => ({ status: 401, body: 'Unauthorized' }),
    );

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('Unauthorized');
    expect(textOf(result)).not.toContain('NW 7.54');
  });
});

describe('GetTypeInfo', () => {
  it('tries the data element endpoint when the name is not a domain', async () => {
    const { result, calls } = await callHandler(
      (c) => handleGetTypeInfo(c, { type_name: 'ZDE' }),
      (call) => (call.url.pathname.includes('/domains/') ? { status: 404, body: 'no' } : { body: '<de/>' }),
    );

    expect(result.isError).toBe(false);
    expect(textOf(result)).toBe('<de/>');
    expect(calls.map((call) => call.url.pathname)).toEqual([
      '/sap/bc/adt/ddic/domains/ZDE/source/main',
      '/sap/bc/adt/ddic/dataelements/ZDE',
    ]);
  });

  it('reports the second failure when the name is neither', async () => {
    const { result } = await callHandler(
      (c) => handleGetTypeInfo(c, { type_name: 'NOPE' }),
      () => ({ status: 404, body: 'not a data element either' }),
    );

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('not a data element either');
  });
});

describe('GetTableContents', () => {
  it('posts the select statement with the row limit', async () => {
    const { result, calls } = await callHandler(
      (c) => handleGetTableContents(c, { table_name: 'dd02l', max_rows: 5 }),
      () => ({ body: '<rows/>' }),
    );

    expect(result.isError).toBe(false);
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url.pathname).toBe('/sap/bc/adt/datapreview/freestyle');
    expect(calls[0].url.searchParams.get('rowNumber')).toBe('5');
    // The table name reaches SQL, so it must be upper-cased, not passed through.
    expect(calls[0].body).toBe('SELECT * FROM DD02L');
    expect(calls[0].headers['content-type']).toBe('text/plain');
  });

  it('defaults to 100 rows', async () => {
    const { calls } = await callHandler((c) => handleGetTableContents(c, { table_name: 'DD02L' }));

    expect(calls[0].url.searchParams.get('rowNumber')).toBe('100');
  });

  it('allows namespaced table names', async () => {
    const { calls } = await callHandler((c) => handleGetTableContents(c, { table_name: '/DMO/FLIGHT' }));

    expect(calls[0].body).toBe('SELECT * FROM /DMO/FLIGHT');
  });

  it.each([
    ['a semicolon', 'DD02L; DROP TABLE X'],
    ['a space', 'DD02L WHERE 1=1'],
    ['a quote', "DD02L'"],
    ['a dash', 'DD02L--'],
  ])('refuses a table name containing %s without contacting the system', async (_label, tableName) => {
    const { result, calls } = await callHandler((c) => handleGetTableContents(c, { table_name: tableName }));

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('Invalid table name');
    expect(calls).toHaveLength(0);
  });
});

describe('ExecuteQuery', () => {
  const twoRows =
    '<dataPreview:tableData xmlns:dataPreview="http://www.sap.com/adt/dataPreview">' +
    '<dataPreview:totalRows>2</dataPreview:totalRows>' +
    '<dataPreview:columns><dataPreview:metadata dataPreview:name="MANDT"/><dataPreview:dataSet>' +
    '<dataPreview:data>000</dataPreview:data><dataPreview:data>100</dataPreview:data>' +
    '</dataPreview:dataSet></dataPreview:columns></dataPreview:tableData>';

  it('posts the query verbatim and returns CSV', async () => {
    const { connection, calls } = fakeConnection(() => ({ body: twoRows }));

    const result = await handleExecuteQuery(connection, { query: 'SELECT mandt FROM t000', maxRows: 5 });

    expect(result.isError).toBe(false);
    expect(textOf(result)).toBe(['# 2 rows', 'MANDT', '000', '100'].join('\n'));
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url.pathname).toBe('/sap/bc/adt/datapreview/freestyle');
    expect(calls[0].url.searchParams.get('rowNumber')).toBe('5');
    expect(calls[0].body).toBe('SELECT mandt FROM t000');
  });

  it('accepts a common table expression', async () => {
    const { connection, calls } = fakeConnection(() => ({ body: twoRows }));

    await handleExecuteQuery(connection, { query: '  WITH +x AS ( SELECT mandt FROM t000 ) SELECT * FROM +x  ' });

    // The body is trimmed, otherwise ABAP SQL trips over the leading blanks.
    expect(calls[0].body).toBe('WITH +x AS ( SELECT mandt FROM t000 ) SELECT * FROM +x');
  });

  it.each([
    ['an update', 'UPDATE t000 SET mtext = @x'],
    ['a delete', 'delete from t000'],
    ['a semicolon', 'SELECT * FROM t000; SELECT * FROM t001'],
    ['nothing at all', '   '],
  ])('refuses %s without contacting the system', async (_label, query) => {
    const { connection, calls } = fakeConnection(() => ({ body: twoRows }));

    const result = await handleExecuteQuery(connection, { query });

    expect(result.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it('explains how to switch free SQL back on when it is disabled', async () => {
    const { connection, calls } = fakeConnection(() => ({ body: twoRows }), { system: { allowFreeSql: false } });

    const result = await handleExecuteQuery(connection, { query: 'SELECT mandt FROM t000' });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('allowFreeSql');
    expect(textOf(result)).toContain('SAP_ALLOW_FREE_SQL');
    expect(calls).toHaveLength(0);
  });

  describe('time budget', () => {
    /** Records what reaches connection.request without any HTTP machinery. */
    function recordingConnection(configTimeoutMs: number) {
      const options: Array<{ timeoutMs?: number }> = [];
      const connection = {
        name: 'dev',
        config: { allowFreeSql: true, timeoutMs: configTimeoutMs },
        request: (_path: string, requestOptions: { timeoutMs?: number }) => {
          options.push(requestOptions);
          return Promise.resolve({ status: 200, headers: new Headers(), data: twoRows });
        },
      } as unknown as SapConnection;
      return { connection, options };
    }

    it('grants queries at least a minute even when the system timeout is lower', async () => {
      const { connection, options } = recordingConnection(30_000);

      await handleExecuteQuery(connection, { query: 'SELECT mandt FROM t000' });

      expect(options[0].timeoutMs).toBe(60_000);
    });

    it('keeps a system timeout that is already higher', async () => {
      const { connection, options } = recordingConnection(120_000);

      await handleExecuteQuery(connection, { query: 'SELECT mandt FROM t000' });

      expect(options[0].timeoutMs).toBe(120_000);
    });

    it('lets the call itself decide, in both directions', async () => {
      const { connection, options } = recordingConnection(30_000);

      await handleExecuteQuery(connection, { query: 'SELECT mandt FROM t000', timeoutMs: 300_000 });
      await handleExecuteQuery(connection, { query: 'SELECT mandt FROM t000', timeoutMs: 5_000 });

      expect(options.map((entry) => entry.timeoutMs)).toEqual([300_000, 5_000]);
    });
  });

  it('surfaces a SAP syntax error rather than swallowing it', async () => {
    const { connection } = fakeConnection(() => ({ status: 400, body: 'Only one SELECT statement is allowed.' }));

    const result = await handleExecuteQuery(connection, { query: 'SELECT * FROM t000 UP TO 1 ROWS' });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('Only one SELECT statement is allowed');
  });
});

describe('GetSystemInfo', () => {
  it('posts the fixed CVERS query, unaffected by allowFreeSql', async () => {
    const { connection, calls } = fakeConnection(() => OK, { system: { allowFreeSql: false } });

    const result = await handleGetSystemInfo(connection);

    expect(result.isError).toBe(false);
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url.pathname).toBe('/sap/bc/adt/datapreview/freestyle');
    expect(calls[0].body).toBe('SELECT COMPONENT, RELEASE, EXTRELEASE FROM CVERS ORDER BY COMPONENT');
  });
});

describe('GetWhereUsed', () => {
  const twoReferences =
    '<usageReferences:usageReferenceResult xmlns:usageReferences="http://www.sap.com/adt/ris/usageReferences" ' +
    'xmlns:adtcore="http://www.sap.com/adt/core">' +
    '<usageReferences:referencedObjects>' +
    '<usageReferences:referencedObject uri="/sap/bc/adt/programs/programs/ZCALLER1" usageInformation="used">' +
    '<usageReferences:adtObject adtcore:name="ZCALLER1" adtcore:type="PROG/P" adtcore:description="Caller one">' +
    '<adtcore:packageRef adtcore:name="ZPKG1"/>' +
    '</usageReferences:adtObject>' +
    '</usageReferences:referencedObject>' +
    '<usageReferences:referencedObject uri="/sap/bc/adt/programs/programs/ZCALLER2" usageInformation="used">' +
    '<usageReferences:adtObject adtcore:name="ZCALLER2" adtcore:type="PROG/P">' +
    '<adtcore:packageRef adtcore:name="ZPKG2"/>' +
    '</usageReferences:adtObject>' +
    '</usageReferences:referencedObject>' +
    '</usageReferences:referencedObjects>' +
    '</usageReferences:usageReferenceResult>';

  it('posts the object uri and parses the referenced objects', async () => {
    const { result, calls } = await callHandler(
      (c) => handleGetWhereUsed(c, { object_type: 'class', object_name: 'ZCL_FOO' }),
      () => ({ body: twoReferences }),
    );

    expect(result.isError).toBe(false);
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url.pathname).toBe('/sap/bc/adt/repository/informationsystem/usageReferences');
    expect(calls[0].url.searchParams.get('uri')).toBe('/sap/bc/adt/oo/classes/ZCL_FOO');
    expect(textOf(result)).toBe(
      [
        'PROG/P ZCALLER1 (ZPKG1) [used]: /sap/bc/adt/programs/programs/ZCALLER1',
        'PROG/P ZCALLER2 (ZPKG2) [used]: /sap/bc/adt/programs/programs/ZCALLER2',
      ].join('\n'),
    );
  });

  it('builds the object uri per type', async () => {
    const cases: Array<[Parameters<typeof handleGetWhereUsed>[1], string]> = [
      [{ object_type: 'program', object_name: 'ZFOO' }, '/sap/bc/adt/programs/programs/ZFOO'],
      [{ object_type: 'interface', object_name: 'ZIF_FOO' }, '/sap/bc/adt/oo/interfaces/ZIF_FOO'],
      [{ object_type: 'table', object_name: 'ZTAB' }, '/sap/bc/adt/ddic/tables/ZTAB'],
      [{ object_type: 'cds_view', object_name: 'i_currency' }, '/sap/bc/adt/ddic/ddl/sources/I_CURRENCY'],
    ];

    const results = await Promise.all(
      cases.map(([args]) =>
        callHandler(
          (c) => handleGetWhereUsed(c, args),
          () => ({ body: twoReferences }),
        ),
      ),
    );

    results.forEach(({ calls }, index) => {
      expect(calls[0].url.searchParams.get('uri')).toBe(cases[index][1]);
    });
  });

  it('reports no usages without falling back to raw XML', async () => {
    const empty =
      '<usageReferences:usageReferenceResult xmlns:usageReferences="http://www.sap.com/adt/ris/usageReferences">' +
      '<usageReferences:referencedObjects/>' +
      '</usageReferences:usageReferenceResult>';

    const { result } = await callHandler(
      (c) => handleGetWhereUsed(c, { object_type: 'table', object_name: 'ZUNUSED' }),
      () => ({ body: empty }),
    );

    expect(textOf(result)).toBe('No usages found.');
  });

  it('falls back to the raw XML for an unrecognised response shape', async () => {
    const { result } = await callHandler(
      (c) => handleGetWhereUsed(c, { object_type: 'table', object_name: 'ZTAB' }),
describe('GetPackage', () => {
  const nodeStructure = `<?xml version="1.0" encoding="utf-8"?>
<asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">
  <asx:values>
    <DATA>
      <TREE_CONTENT>
        <SEU_ADT_REPOSITORY_OBJ_NODE>
          <OBJECT_TYPE>CLAS/OC</OBJECT_TYPE>
          <OBJECT_NAME>ZCL_FOO</OBJECT_NAME>
          <DESCRIPTION>A class</DESCRIPTION>
          <OBJECT_URI>/sap/bc/adt/oo/classes/zcl_foo</OBJECT_URI>
        </SEU_ADT_REPOSITORY_OBJ_NODE>
        <SEU_ADT_REPOSITORY_OBJ_NODE>
          <OBJECT_TYPE>DEVC/K</OBJECT_TYPE>
          <OBJECT_NAME>ZSUB</OBJECT_NAME>
        </SEU_ADT_REPOSITORY_OBJ_NODE>
      </TREE_CONTENT>
    </DATA>
  </asx:values>
</asx:abap>`;

  it('posts the node structure query and flattens the result', async () => {
    const { result, calls } = await callHandler(
      (c) => handleGetPackage(c, { package_name: 'ZPKG' }),
      () => ({ body: nodeStructure }),
    );

    expect(calls[0].method).toBe('POST');
    expect(calls[0].url.pathname).toBe('/sap/bc/adt/repository/nodestructure');
    expect(calls[0].url.searchParams.get('parent_type')).toBe('DEVC/K');
    expect(calls[0].url.searchParams.get('parent_name')).toBe('ZPKG');
    expect(calls[0].url.searchParams.get('withShortDescriptions')).toBe('true');

    // Entries without a URI are not addressable and are dropped.
    expect(JSON.parse(textOf(result))).toEqual([
      {
        OBJECT_TYPE: 'CLAS/OC',
        OBJECT_NAME: 'ZCL_FOO',
        OBJECT_DESCRIPTION: 'A class',
        OBJECT_URI: '/sap/bc/adt/oo/classes/zcl_foo',
      },
    ]);
  });

  it('encodes a namespaced package name exactly once', async () => {
    const { calls } = await callHandler(
      (c) => handleGetPackage(c, { package_name: '/DMO/FLIGHT' }),
      () => ({ body: nodeStructure }),
    );

    // The raw value must arrive at SAP; double encoding used to break this.
    expect(calls[0].url.searchParams.get('parent_name')).toBe('/DMO/FLIGHT');
  });

  it('handles a package holding a single object', async () => {
    const single = nodeStructure.replace(
      /<SEU_ADT_REPOSITORY_OBJ_NODE>\s*<OBJECT_TYPE>DEVC[\S\s]*?<\/SEU_ADT_REPOSITORY_OBJ_NODE>/u,
      '',
    );
    const { result } = await callHandler(
      (c) => handleGetPackage(c, { package_name: 'ZPKG' }),
      () => ({ body: single }),
    );

    expect(JSON.parse(textOf(result))).toHaveLength(1);
  });

  it('returns an empty list for an empty package', async () => {
    const { result } = await callHandler(
      (c) => handleGetPackage(c, { package_name: 'ZPKG' }),
      () => ({
        body: '<?xml version="1.0"?><asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values/></asx:abap>',
      }),
    );

    expect(JSON.parse(textOf(result))).toEqual([]);
  });
});

describe('query building', () => {
  it('SearchObject passes the query and result limit', async () => {
    const { calls } = await callHandler((c) => handleSearchObject(c, { query: 'ZCL_*', maxResults: 20 }));

    expect(calls[0].url.pathname).toBe('/sap/bc/adt/repository/informationsystem/search');
    expect(calls[0].url.searchParams.get('operation')).toBe('quickSearch');
    expect(calls[0].url.searchParams.get('query')).toBe('ZCL_*');
    expect(calls[0].url.searchParams.get('maxResults')).toBe('20');
  });

  it('SearchObject defaults to 100 results', async () => {
    const { calls } = await callHandler((c) => handleSearchObject(c, { query: 'ZCL_*' }));

    expect(calls[0].url.searchParams.get('maxResults')).toBe('100');
  });

  it('GetTransaction sends the object uri and both facets', async () => {
    const { calls } = await callHandler((c) => handleGetTransaction(c, { transaction_name: 'SE93' }));

    expect(calls[0].url.pathname).toBe('/sap/bc/adt/repository/informationsystem/objectproperties/values');
    expect(calls[0].url.searchParams.get('uri')).toBe('/sap/bc/adt/vit/wb/object_type/trant/object_name/SE93');
    expect(calls[0].url.searchParams.getAll('facet')).toEqual(['package', 'appl']);
  });
});

describe('failures reach the caller', () => {
  it('turns a network failure into a tool error rather than throwing', async () => {
    const { result } = await callHandler(
      (c) => handleGetProgram(c, { program_name: 'ZFOO' }),
      () => new Error('socket hang up'),
    );

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('socket hang up');
  });

  it('surfaces the ADT error body, which explains the problem', async () => {
    const { result } = await callHandler(
      (c) => handleGetProgram(c, { program_name: 'ZFOO' }),
      () => ({ status: 403, body: '<exc><localizedMessage>Not authorized</localizedMessage></exc>' }),
    );

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('Not authorized');
  });
});

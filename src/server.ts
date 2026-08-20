import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { SapConnection } from './connection/SapConnection.js';
import type { ConnectionRegistry } from './connection/registry.js';
import { return_error, type ToolResult } from './lib/result.js';
import { SERVER_NAME, SERVER_VERSION } from './version.js';

import { handleExecuteQuery } from './handlers/handleExecuteQuery.js';
import { handleGetBehaviorDefinition } from './handlers/handleGetBehaviorDefinition.js';
import { handleGetCDSView } from './handlers/handleGetCDSView.js';
import { handleGetClass } from './handlers/handleGetClass.js';
import { handleGetFunction } from './handlers/handleGetFunction.js';
import { handleGetFunctionGroup } from './handlers/handleGetFunctionGroup.js';
import { handleGetInclude } from './handlers/handleGetInclude.js';
import { handleGetInterface } from './handlers/handleGetInterface.js';
import { handleGetPackage } from './handlers/handleGetPackage.js';
import { handleGetProgram } from './handlers/handleGetProgram.js';
import { handleGetServiceDefinition } from './handlers/handleGetServiceDefinition.js';
import { handleGetStructure } from './handlers/handleGetStructure.js';
import { handleGetTable } from './handlers/handleGetTable.js';
import { handleGetTableContents } from './handlers/handleGetTableContents.js';
import { handleGetTransaction } from './handlers/handleGetTransaction.js';
import { handleGetTypeInfo } from './handlers/handleGetTypeInfo.js';
import { handleListSystems } from './handlers/handleListSystems.js';
import { handleSearchObject } from './handlers/handleSearchObject.js';
import { setLogSink } from './lib/log.js';

/**
 * Ceiling for both row-returning tools. A model asking for millions of rows
 * would hurt the SAP system long before the answer became useful.
 */
const MAX_ROW_LIMIT = 5000;

/** Mixed into every ADT tool so a call can pick which system to talk to. */
const systemArgument = {
  system: z
    .string()
    .optional()
    .describe('Name of a configured SAP system (see ListSystems). Uses the default system when omitted.'),
};

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: z.ZodRawShape;
  handler: (connection: SapConnection, args: never) => Promise<ToolResult>;
}

/** Keeps each entry's schema and handler arguments checked against each other. */
function defineTool<Shape extends z.ZodRawShape>(
  name: string,
  description: string,
  inputSchema: Shape,
  handler: (connection: SapConnection, args: z.infer<z.ZodObject<Shape>>) => Promise<ToolResult>,
): ToolDefinition {
  return { name, description, inputSchema, handler };
}

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  defineTool(
    'GetProgram',
    'Retrieve ABAP program source code',
    { program_name: z.string().describe('Name of the ABAP program') },
    handleGetProgram,
  ),
  defineTool(
    'GetClass',
    'Retrieve ABAP class source code',
    { class_name: z.string().describe('Name of the ABAP class') },
    handleGetClass,
  ),
  defineTool(
    'GetFunctionGroup',
    'Retrieve ABAP Function Group source code',
    { function_group: z.string().describe('Name of the function module') },
    handleGetFunctionGroup,
  ),
  defineTool(
    'GetFunction',
    'Retrieve ABAP Function Module source code',
    {
      function_name: z.string().describe('Name of the function module'),
      function_group: z.string().describe('Name of the function group'),
    },
    handleGetFunction,
  ),
  defineTool(
    'GetStructure',
    'Retrieve ABAP Structure',
    { structure_name: z.string().describe('Name of the ABAP Structure') },
    handleGetStructure,
  ),
  defineTool(
    'GetTable',
    'Retrieve ABAP table structure',
    { table_name: z.string().describe('Name of the ABAP table') },
    handleGetTable,
  ),
  defineTool(
    'GetTableContents',
    'Retrieve all columns of an ABAP table. Prefer ExecuteQuery when only some columns or rows are needed.',
    {
      table_name: z.string().describe('Name of the ABAP table'),
      max_rows: z.number().int().min(1).max(MAX_ROW_LIMIT).default(100).describe('Maximum number of rows to retrieve'),
    },
    handleGetTableContents,
  ),
  defineTool(
    'ExecuteQuery',
    'Run a read-only ABAP SQL SELECT against a SAP system and return the rows as CSV. ' +
      'Use this rather than GetTableContents whenever only some columns or rows are needed: ' +
      'projecting and filtering keeps the answer small. Aggregates such as COUNT(*) work too. ' +
      'Dialect notes: ABAP SQL, exactly one SELECT statement, no trailing semicolon, ' +
      'ASCENDING/DESCENDING instead of ASC/DESC, and no LIMIT clause - use maxRows instead.',
    {
      query: z
        .string()
        .describe("The SELECT statement, for example: SELECT carrid, connid FROM sflight WHERE carrid = 'LH'"),
      maxRows: z.number().int().min(1).max(MAX_ROW_LIMIT).default(100).describe('Maximum number of rows to return'),
      timeoutMs: z
        .number()
        .int()
        .min(1000)
        .max(600_000)
        .optional()
        .describe(
          'Time budget for this query in milliseconds. Defaults to at least 60000, ' +
            'since queries run longer than metadata reads. Raise it for heavy joins or LIKE scans.',
        ),
    },
    handleExecuteQuery,
  ),
  defineTool(
    'GetPackage',
    'Retrieve ABAP package details',
    { package_name: z.string().describe('Name of the ABAP package') },
    handleGetPackage,
  ),
  defineTool(
    'GetTypeInfo',
    'Retrieve ABAP type information',
    { type_name: z.string().describe('Name of the ABAP type') },
    handleGetTypeInfo,
  ),
  defineTool(
    'GetInclude',
    'Retrieve ABAP Include Source Code',
    { include_name: z.string().describe('Name of the ABAP Include') },
    handleGetInclude,
  ),
  defineTool(
    'SearchObject',
    'Search for ABAP objects using quick search',
    {
      query: z.string().describe('Search query string (use * wildcard for partial match)'),
      maxResults: z.number().default(100).describe('Maximum number of results to return'),
    },
    handleSearchObject,
  ),
  defineTool(
    'GetTransaction',
    'Retrieve ABAP transaction details',
    { transaction_name: z.string().describe('Name of the ABAP transaction') },
    handleGetTransaction,
  ),
  defineTool(
    'GetCDSView',
    'Retrieve CDS view (DDL source) source code',
    {
      cds_view_name: z.string().describe('Name of the CDS view (DDL source name, e.g. I_CURRENCY)'),
    },
    handleGetCDSView,
  ),
  defineTool(
    'GetInterface',
    'Retrieve ABAP interface source code',
    { interface_name: z.string().describe('Name of the ABAP interface') },
    handleGetInterface,
  ),
  defineTool(
    'GetBehaviorDefinition',
    'Retrieve RAP Behavior Definition (BDEF) source code (requires ~NW 7.54 / S/4HANA)',
    {
      behavior_definition_name: z.string().describe('Name of the RAP Behavior Definition (e.g. I_MY_ENTITY)'),
    },
    handleGetBehaviorDefinition,
  ),
  defineTool(
    'GetServiceDefinition',
    'Retrieve RAP Service Definition (SRVD) source code (requires ~NW 7.54 / S/4HANA)',
    {
      service_definition_name: z.string().describe('Name of the RAP Service Definition (e.g. Z_MY_SERVICE)'),
    },
    handleGetServiceDefinition,
  ),
];

export function createServer(registry: ConnectionRegistry): McpServer {
  // Declaring the logging capability makes the SDK answer logging/setLevel on
  // its own and drop anything below the level the client asked for.
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { capabilities: { logging: {} } });

  // Diagnostics reach the client through the protocol, where a user can
  // actually see them, instead of only a log file they have to go find.
  // Failures are swallowed on purpose: a notification sent before the
  // handshake, or after the transport closed, must never break a tool call.
  setLogSink((level, message) => {
    void server.server.sendLoggingMessage({ level, logger: SERVER_NAME, data: message }).catch(() => undefined);
  });

  for (const tool of TOOL_DEFINITIONS) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: { ...tool.inputSchema, ...systemArgument } },
      async (args) => {
        const { system, ...rest } = (args ?? {}) as { system?: string };
        try {
          // Selecting an unknown system is a user mistake, not a protocol
          // failure, so it comes back as a readable tool error.
          return await tool.handler(registry.get(system), rest as never);
        } catch (error) {
          return return_error(error);
        }
      },
    );
  }

  server.registerTool(
    'ListSystems',
    {
      description:
        'List the configured SAP systems, which one is the default, and any configuration problems. Returns no credentials.',
      inputSchema: {},
    },
    async () => handleListSystems(registry),
  );

  return server;
}

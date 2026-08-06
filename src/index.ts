#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Import handler functions
import { handleGetProgram } from './handlers/handleGetProgram.js';
import { handleGetClass } from './handlers/handleGetClass.js';
import { handleGetFunctionGroup } from './handlers/handleGetFunctionGroup.js';
import { handleGetFunction } from './handlers/handleGetFunction.js';
import { handleGetTable } from './handlers/handleGetTable.js';
import { handleGetStructure } from './handlers/handleGetStructure.js';
import { handleGetTableContents } from './handlers/handleGetTableContents.js';
import { handleGetPackage } from './handlers/handleGetPackage.js';
import { handleGetInclude } from './handlers/handleGetInclude.js';
import { handleGetTypeInfo } from './handlers/handleGetTypeInfo.js';
import { handleGetInterface } from './handlers/handleGetInterface.js';
import { handleGetTransaction } from './handlers/handleGetTransaction.js';
import { handleSearchObject } from './handlers/handleSearchObject.js';
import { handleGetCDSView } from './handlers/handleGetCDSView.js';
import { handleGetBehaviorDefinition } from './handlers/handleGetBehaviorDefinition.js';
import { handleGetServiceDefinition } from './handlers/handleGetServiceDefinition.js';

// Import shared utility functions and types
import { getBaseUrl, getAuthHeaders, createAxiosInstance, makeAdtRequest, return_error, return_response } from './lib/utils.js';

// Load environment variables from the .env file next to the installed package.
// loadEnvFile throws when the file is absent, which is a perfectly normal setup
// (MCP clients usually pass the variables through their own `env` block).
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
try {
  process.loadEnvFile(path.join(packageRoot, '.env'));
} catch {
  // no .env file — rely on the ambient environment
}

// Interface for SAP configuration
export interface SapConfig {
  url: string;
  username: string;
  password: string;
  client: string;
}

/**
 * Retrieves SAP configuration from environment variables.
 *
 * @returns {SapConfig} The SAP configuration object.
 * @throws {Error} If any required environment variable is missing.
 */
export function getConfig(): SapConfig {
  const url = process.env.SAP_URL;
  const username = process.env.SAP_USERNAME;
  const password = process.env.SAP_PASSWORD;
  const client = process.env.SAP_CLIENT;

  // Check if all required environment variables are set
  if (!url || !username || !password || !client) {
    throw new Error(`Missing required environment variables. Required variables:
- SAP_URL
- SAP_USERNAME
- SAP_PASSWORD
- SAP_CLIENT`);
  }

  return { url, username, password, client };
}

/**
 * Server class for interacting with ABAP systems via ADT.
 */
export class mcp_abap_adt_server {
  private server: Server;  // Instance of the MCP server
  private sapConfig: SapConfig; // SAP configuration

  /**
   * Constructor for the mcp_abap_adt_server class.
   */
  constructor() {
    this.sapConfig = getConfig(); // Load SAP configuration
    this.server = new Server(  // Initialize the MCP server
      {
        name: 'mcp-abap-adt', // Server name
        version: '0.1.0',       // Server version
      },
      {
        capabilities: {
          tools: {}, // Initially, no tools are registered
        },
      }
    );

    this.setupHandlers(); // Setup request handlers
  }

  /**
   * Sets up request handlers for listing and calling tools.
   * @private
   */
  private setupHandlers() {
    // Setup tool handlers

    // Handler for ListToolsRequest
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [ // Define available tools
          {
            name: 'GetProgram',
            description: 'Retrieve ABAP program source code',
            inputSchema: {
              type: 'object',
              properties: {
                program_name: {
                  type: 'string',
                  description: 'Name of the ABAP program'
                }
              },
              required: ['program_name']
            }
          },
          {
            name: 'GetClass',
            description: 'Retrieve ABAP class source code',
            inputSchema: {
              type: 'object',
              properties: {
                class_name: {
                  type: 'string',
                  description: 'Name of the ABAP class'
                }
              },
              required: ['class_name']
            }
          },
          {
            name: 'GetFunctionGroup',
            description: 'Retrieve ABAP Function Group source code',
            inputSchema: {
              type: 'object',
              properties: {
                function_group: {
                  type: 'string',
                  description: 'Name of the function module'
                }
              },
              required: ['function_group']
            }
          },
          {
            name: 'GetFunction',
            description: 'Retrieve ABAP Function Module source code',
            inputSchema: {
              type: 'object',
              properties: {
                function_name: {
                  type: 'string',
                  description: 'Name of the function module'
                },
                function_group: {
                  type: 'string',
                  description: 'Name of the function group'
                }
              },
              required: ['function_name', 'function_group']
            }
          },
          {
            name: 'GetStructure',
            description: 'Retrieve ABAP Structure',
            inputSchema: {
              type: 'object',
              properties: {
                structure_name: {
                  type: 'string',
                  description: 'Name of the ABAP Structure'
                }
              },
              required: ['structure_name']
            }
          },
          {
            name: 'GetTable',
            description: 'Retrieve ABAP table structure',
            inputSchema: {
              type: 'object',
              properties: {
                table_name: {
                  type: 'string',
                  description: 'Name of the ABAP table'
                }
              },
              required: ['table_name']
            }
          },
          {
            name: 'GetTableContents',
            description: 'Retrieve contents of an ABAP table',
            inputSchema: {
              type: 'object',
              properties: {
                table_name: {
                  type: 'string',
                  description: 'Name of the ABAP table'
                },
                max_rows: {
                  type: 'number',
                  description: 'Maximum number of rows to retrieve',
                  default: 100
                }
              },
              required: ['table_name']
            }
          },
          {
            name: 'GetPackage',
            description: 'Retrieve ABAP package details',
            inputSchema: {
              type: 'object',
              properties: {
                package_name: {
                  type: 'string',
                  description: 'Name of the ABAP package'
                }
              },
              required: ['package_name']
            }
          },
          {
            name: 'GetTypeInfo',
            description: 'Retrieve ABAP type information',
            inputSchema: {
              type: 'object',
              properties: {
                type_name: {
                  type: 'string',
                  description: 'Name of the ABAP type'
                }
              },
              required: ['type_name']
            }
          },
          {
            name: 'GetInclude',
            description: 'Retrieve ABAP Include Source Code',
            inputSchema: {
              type: 'object',
              properties: {
                include_name: {
                  type: 'string',
                  description: 'Name of the ABAP Include'
                }
              },
              required: ['include_name']
            }
          },
          {
            name: 'SearchObject',
            description: 'Search for ABAP objects using quick search',
            inputSchema: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: 'Search query string (use * wildcard for partial match)'
                },
                maxResults: {
                  type: 'number',
                  description: 'Maximum number of results to return',
                  default: 100
                }
              },
              required: ['query']
            }
          },
          {
            name: 'GetTransaction',
            description: 'Retrieve ABAP transaction details',
            inputSchema: {
              type: 'object',
              properties: {
                transaction_name: {
                  type: 'string',
                  description: 'Name of the ABAP transaction'
                }
              },
              required: ['transaction_name']
            }
          },
          {
            name: 'GetCDSView',
            description: 'Retrieve CDS view (DDL source) source code',
            inputSchema: {
              type: 'object',
              properties: {
                cds_view_name: {
                  type: 'string',
                  description: 'Name of the CDS view (DDL source name, e.g. I_CURRENCY)'
                }
              },
              required: ['cds_view_name']
            }
          },
          {
            name: 'GetInterface',
            description: 'Retrieve ABAP interface source code',
            inputSchema: {
              type: 'object',
              properties: {
                interface_name: {
                  type: 'string',
                  description: 'Name of the ABAP interface'
                }
              },
              required: ['interface_name']
            }
          },
          {
            name: 'GetBehaviorDefinition',
            description: 'Retrieve RAP Behavior Definition (BDEF) source code (requires ~NW 7.54 / S/4HANA)',
            inputSchema: {
              type: 'object',
              properties: {
                behavior_definition_name: {
                  type: 'string',
                  description: 'Name of the RAP Behavior Definition (e.g. I_MY_ENTITY)'
                }
              },
              required: ['behavior_definition_name']
            }
          },
          {
            name: 'GetServiceDefinition',
            description: 'Retrieve RAP Service Definition (SRVD) source code (requires ~NW 7.54 / S/4HANA)',
            inputSchema: {
              type: 'object',
              properties: {
                service_definition_name: {
                  type: 'string',
                  description: 'Name of the RAP Service Definition (e.g. Z_MY_SERVICE)'
                }
              },
              required: ['service_definition_name']
            }
          }
        ]
      };
    });

    // Handler for CallToolRequest
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      switch (request.params.name) {
        case 'GetProgram':
          return await handleGetProgram(request.params.arguments);
        case 'GetClass':
          return await handleGetClass(request.params.arguments);
        case 'GetFunction':
          return await handleGetFunction(request.params.arguments);
        case 'GetFunctionGroup':
          return await handleGetFunctionGroup(request.params.arguments);
        case 'GetStructure':
          return await handleGetStructure(request.params.arguments);
        case 'GetTable':
          return await handleGetTable(request.params.arguments);
        case 'GetTableContents':
          return await handleGetTableContents(request.params.arguments);
        case 'GetPackage':
          return await handleGetPackage(request.params.arguments);
        case 'GetTypeInfo':
          return await handleGetTypeInfo(request.params.arguments);
        case 'GetInclude':
          return await handleGetInclude(request.params.arguments);
        case 'SearchObject':
          return await handleSearchObject(request.params.arguments);
        case 'GetInterface':
          return await handleGetInterface(request.params.arguments);
        case 'GetTransaction':
          return await handleGetTransaction(request.params.arguments);
        case 'GetCDSView':
          return await handleGetCDSView(request.params.arguments);
        case 'GetBehaviorDefinition':
          return await handleGetBehaviorDefinition(request.params.arguments);
        case 'GetServiceDefinition':
          return await handleGetServiceDefinition(request.params.arguments);
        default:
          throw new McpError(
            ErrorCode.MethodNotFound,
            `Unknown tool: ${request.params.name}`
          );
      }
    });

    // Handle server shutdown on SIGINT (Ctrl+C)
    process.on('SIGINT', async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  /**
   * Starts the MCP server and connects it to the transport.
   */
  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
  }
}

// Only bootstrap when started as a program. Importing this module (from tests or
// tooling) must not spawn a stdio server or read the SAP configuration.
const isEntryPoint =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntryPoint) {
  const server = new mcp_abap_adt_server();
  server.run().catch(() => {
    process.exit(1);
  });
}

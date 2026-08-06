import type { SapConnection } from '../connection/SapConnection.js';
import { return_error, return_response, type ToolResult } from '../lib/result.js';

export async function handleGetInclude(connection: SapConnection, args: { include_name: string }): Promise<ToolResult> {
  try {
    const path = `/sap/bc/adt/programs/includes/${encodeURIComponent(args.include_name)}/source/main`;
    return return_response(await connection.request(path));
  } catch (error) {
    return return_error(error);
  }
}

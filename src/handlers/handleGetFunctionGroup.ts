import type { SapConnection } from '../connection/SapConnection.js';
import { return_error, return_response, type ToolResult } from '../lib/result.js';

export async function handleGetFunctionGroup(
  connection: SapConnection,
  args: { function_group: string },
): Promise<ToolResult> {
  try {
    const path = `/sap/bc/adt/functions/groups/${encodeURIComponent(args.function_group)}/source/main`;
    return return_response(await connection.request(path));
  } catch (error) {
    return return_error(error);
  }
}

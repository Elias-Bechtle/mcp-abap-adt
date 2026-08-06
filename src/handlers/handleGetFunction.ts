import type { SapConnection } from '../connection/SapConnection.js';
import { return_error, return_response, type ToolResult } from '../lib/result.js';

export async function handleGetFunction(
  connection: SapConnection,
  args: { function_name: string; function_group: string },
): Promise<ToolResult> {
  try {
    const group = encodeURIComponent(args.function_group);
    const module = encodeURIComponent(args.function_name);
    const path = `/sap/bc/adt/functions/groups/${group}/fmodules/${module}/source/main`;
    return return_response(await connection.request(path));
  } catch (error) {
    return return_error(error);
  }
}

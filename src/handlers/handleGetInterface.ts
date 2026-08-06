import type { SapConnection } from '../connection/SapConnection.js';
import { return_error, return_response, type ToolResult } from '../lib/result.js';

export async function handleGetInterface(
  connection: SapConnection,
  args: { interface_name: string },
): Promise<ToolResult> {
  try {
    const path = `/sap/bc/adt/oo/interfaces/${encodeURIComponent(args.interface_name)}/source/main`;
    return return_response(await connection.request(path));
  } catch (error) {
    return return_error(error);
  }
}

import type { SapConnection } from '../connection/SapConnection.js';
import { return_error, return_response, type ToolResult } from '../lib/result.js';

export async function handleGetStructure(
  connection: SapConnection,
  args: { structure_name: string },
): Promise<ToolResult> {
  try {
    const path = `/sap/bc/adt/ddic/structures/${encodeURIComponent(args.structure_name)}/source/main`;
    return return_response(await connection.request(path));
  } catch (error) {
    return return_error(error);
  }
}

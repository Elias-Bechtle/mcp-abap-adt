import type { SapConnection } from '../connection/SapConnection.js';
import { return_error, return_response, type ToolResult } from '../lib/result.js';

export async function handleGetClass(connection: SapConnection, args: { class_name: string }): Promise<ToolResult> {
  try {
    const path = `/sap/bc/adt/oo/classes/${encodeURIComponent(args.class_name)}/source/main`;
    return return_response(await connection.request(path));
  } catch (error) {
    return return_error(error);
  }
}

import type { SapConnection } from '../connection/SapConnection.js';
import { return_error, return_response, type ToolResult } from '../lib/result.js';

export async function handleGetCDSView(
  connection: SapConnection,
  args: { cds_view_name: string },
): Promise<ToolResult> {
  try {
    const name = encodeURIComponent(args.cds_view_name.toUpperCase());
    const path = `/sap/bc/adt/ddic/ddl/sources/${name}/source/main`;
    return return_response(await connection.request(path));
  } catch (error) {
    return return_error(error);
  }
}

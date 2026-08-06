import type { SapConnection } from '../connection/SapConnection.js';
import { return_error, return_response, type ToolResult } from '../lib/result.js';

export async function handleGetTypeInfo(
  connection: SapConnection,
  args: { type_name: string },
): Promise<ToolResult> {
  const name = encodeURIComponent(args.type_name);
  try {
    return return_response(await connection.request(`/sap/bc/adt/ddic/domains/${name}/source/main`));
  } catch {
    // Not a domain — the same name may still be a data element.
    try {
      return return_response(await connection.request(`/sap/bc/adt/ddic/dataelements/${name}`));
    } catch (error) {
      return return_error(error);
    }
  }
}

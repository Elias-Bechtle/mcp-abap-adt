import type { SapConnection } from '../connection/SapConnection.js';
import { return_error, return_response, type ToolResult } from '../lib/result.js';

export async function handleGetTableContents(
  connection: SapConnection,
  args: { table_name: string; max_rows?: number },
): Promise<ToolResult> {
  try {
    const tableName = args.table_name.toUpperCase();
    // Guard against anything but a plain table/view name (namespaces like /NS/TAB are allowed)
    if (!/^[A-Z0-9_/]+$/.test(tableName)) {
      throw new Error(`Invalid table name: ${args.table_name}`);
    }

    const response = await connection.request('/sap/bc/adt/datapreview/freestyle', {
      method: 'POST',
      body: `SELECT * FROM ${tableName}`,
      query: { rowNumber: args.max_rows ?? 100 },
      headers: { 'Content-Type': 'text/plain', Accept: 'application/xml, text/plain, */*' },
    });
    return return_response(response);
  } catch (error) {
    return return_error(error);
  }
}

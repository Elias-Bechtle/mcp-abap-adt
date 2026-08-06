import type { SapConnection } from '../connection/SapConnection.js';
import { isHttpStatus } from '../connection/errors.js';
import { return_error, return_response, type ToolResult } from '../lib/result.js';

export async function handleGetTable(connection: SapConnection, args: { table_name: string }): Promise<ToolResult> {
  try {
    const name = encodeURIComponent(args.table_name);
    try {
      return return_response(await connection.request(`/sap/bc/adt/ddic/tables/${name}/source/main`));
    } catch (error) {
      // The /sap/bc/adt/ddic/tables collection was introduced after NW 7.50 and is
      // not registered in the ADT discovery document on older systems. When it is
      // missing the request 404s. The /sap/bc/adt/ddic/structures endpoint exists on
      // 7.50 and serves transparent tables as well, so fall back to it.
      if (isHttpStatus(error, 404)) {
        return return_response(await connection.request(`/sap/bc/adt/ddic/structures/${name}/source/main`));
      }
      throw error;
    }
  } catch (error) {
    return return_error(error);
  }
}

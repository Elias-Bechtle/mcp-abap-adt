import type { SapConnection } from '../connection/SapConnection.js';
import { return_error, return_response, type ToolResult } from '../lib/result.js';

export async function handleSearchObject(
  connection: SapConnection,
  args: { query: string; maxResults?: number },
): Promise<ToolResult> {
  try {
    const response = await connection.request('/sap/bc/adt/repository/informationsystem/search', {
      query: {
        operation: 'quickSearch',
        query: args.query,
        maxResults: args.maxResults ?? 100,
      },
    });
    return return_response(response);
  } catch (error) {
    return return_error(error);
  }
}

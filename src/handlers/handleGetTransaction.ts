import type { SapConnection } from '../connection/SapConnection.js';
import { return_error, return_response, type ToolResult } from '../lib/result.js';

export async function handleGetTransaction(
  connection: SapConnection,
  args: { transaction_name: string },
): Promise<ToolResult> {
  try {
    const response = await connection.request('/sap/bc/adt/repository/informationsystem/objectproperties/values', {
      query: {
        uri: `/sap/bc/adt/vit/wb/object_type/trant/object_name/${args.transaction_name}`,
        facet: ['package', 'appl'],
      },
    });
    return return_response(response);
  } catch (error) {
    return return_error(error);
  }
}

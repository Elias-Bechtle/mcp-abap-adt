import type { SapConnection } from '../connection/SapConnection.js';
import { return_error, return_response, type ToolResult } from '../lib/result.js';

export async function handleGetProgram(
  connection: SapConnection,
  args: { program_name: string },
): Promise<ToolResult> {
  try {
    const path = `/sap/bc/adt/programs/programs/${encodeURIComponent(args.program_name)}/source/main`;
    return return_response(await connection.request(path));
  } catch (error) {
    return return_error(error);
  }
}

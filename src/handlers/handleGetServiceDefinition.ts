import type { SapConnection } from '../connection/SapConnection.js';
import { isHttpStatus } from '../connection/errors.js';
import { return_error, return_response, type ToolResult } from '../lib/result.js';

export async function handleGetServiceDefinition(
  connection: SapConnection,
  args: { service_definition_name: string },
): Promise<ToolResult> {
  try {
    const name = encodeURIComponent(args.service_definition_name.toUpperCase());
    try {
      return return_response(await connection.request(`/sap/bc/adt/ddic/srvd/sources/${name}/source/main`));
    } catch (error) {
      // The RAP stack (SRVD) does not exist before ~NW 7.54 / S/4HANA, so the
      // srvd/sources collection is not registered in the ADT discovery document
      // on older systems and the request 404s. Surface a clear message rather
      // than the raw ADT 404 XML.
      if (isHttpStatus(error, 404)) {
        throw new Error(
          `Service Definition '${args.service_definition_name}' not found, or the RAP service-definition endpoint is not available on this system (requires ~NW 7.54 / S/4HANA with the RAP stack).`,
          { cause: error },
        );
      }
      throw error;
    }
  } catch (error) {
    return return_error(error);
  }
}

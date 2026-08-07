import type { SapConnection } from '../connection/SapConnection.js';
import { compactDataPreview } from '../lib/dataPreview.js';
import { return_error, return_text, type ToolResult } from '../lib/result.js';

/**
 * A second line of defence, not the first. SAP wraps the statement in
 * `... INTO TABLE @DATA(...) UP TO n ROWS`, so anything but a query is a
 * syntax error there, and it rejects a second statement itself with
 * "Only one SELECT statement is allowed".
 *
 * Deliberately no check for periods: they occur legitimately inside string
 * literals, and multi-statement input is already the server's problem.
 */
export function assertSelectOnly(query: string): void {
  const trimmed = query.trim();
  if (!trimmed) {
    throw new Error('The query is empty.');
  }
  if (!/^(select|with)\b/iu.test(trimmed)) {
    throw new Error(
      `Only SELECT queries are allowed, and this one starts with "${trimmed.split(/\s+/u)[0]}". ` +
        'This server never writes to a SAP system.',
    );
  }
  if (trimmed.includes(';')) {
    throw new Error('Semicolons are not part of ABAP SQL; pass a single SELECT statement.');
  }
}

export async function handleExecuteQuery(
  connection: SapConnection,
  args: { query: string; maxRows?: number },
): Promise<ToolResult> {
  try {
    if (!connection.config.allowFreeSql) {
      throw new Error(
        `Free SQL is disabled for system "${connection.name}". ` +
          'Set "allowFreeSql": true for it in the configuration file, or SAP_ALLOW_FREE_SQL=true if you configure ' +
          'the server through environment variables. GetTableContents still works, but it reads whole tables.',
      );
    }

    assertSelectOnly(args.query);

    const response = await connection.request('/sap/bc/adt/datapreview/freestyle', {
      method: 'POST',
      body: args.query.trim(),
      query: { rowNumber: args.maxRows ?? 100 },
      headers: { 'Content-Type': 'text/plain', Accept: 'application/xml, text/plain, */*' },
    });
    return return_text(compactDataPreview(response.data));
  } catch (error) {
    return return_error(error);
  }
}

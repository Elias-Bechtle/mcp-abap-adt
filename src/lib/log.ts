/**
 * Diagnostics must never touch stdout: on a stdio MCP server that stream
 * carries JSON-RPC frames and any stray byte corrupts the protocol.
 */
export function logWarn(message: string): void {
  process.stderr.write(`[mcp-abap-adt] ${message}\n`);
}

export function logDebug(message: string): void {
  if (process.env.MCP_ABAP_ADT_DEBUG) {
    process.stderr.write(`[mcp-abap-adt] ${message}\n`);
  }
}

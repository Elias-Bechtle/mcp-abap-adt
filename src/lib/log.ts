/**
 * Levels this server uses, a subset of the eight the MCP logging capability
 * defines. The client decides how much of it it wants via `logging/setLevel`.
 */
export type LogLevel = 'debug' | 'info' | 'warning' | 'error';

/** Forwards a message to the connected MCP client. Set once the server is up. */
export type LogSink = (level: LogLevel, message: string) => void;

let sink: LogSink | undefined;

export function setLogSink(next: LogSink | undefined): void {
  sink = next;
}

/**
 * Diagnostics must never touch stdout: on a stdio MCP server that stream
 * carries JSON-RPC frames and any stray byte corrupts the protocol.
 *
 * stderr stays the fallback rather than the only channel. It works before the
 * handshake and when a client ignores log notifications, but reaching it means
 * finding the client's log file - which is why anything worth seeing also goes
 * to the client through the protocol.
 */
function emit(level: LogLevel, message: string, verbose: boolean): void {
  if (verbose) {
    process.stderr.write(`[mcp-abap-adt] ${message}\n`);
  }
  sink?.(level, message);
}

export function logWarn(message: string): void {
  emit('warning', message, true);
}

/**
 * Per-call detail, off unless asked for. The gate is deliberately the same for
 * both channels: without it the server stays quiet on the wire too, since a
 * client that never called `logging/setLevel` would otherwise receive a
 * notification for every single ADT request.
 */
export function logDebug(message: string): void {
  const verbose = Boolean(process.env.MCP_ABAP_ADT_DEBUG);
  if (verbose) emit('debug', message, true);
}

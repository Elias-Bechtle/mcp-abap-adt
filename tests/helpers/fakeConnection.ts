import { createInlineProvider } from '../../src/auth/providers/inline.js';
import { SapConnection } from '../../src/connection/SapConnection.js';
import { SystemConfigSchema, type ResolvedSystem, type SystemConfig } from '../../src/config/schema.js';

export interface RecordedCall {
  url: URL;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

export interface FakeResponse {
  status?: number;
  body?: string;
  headers?: Record<string, string>;
  setCookie?: string[];
}

export type Responder = (call: RecordedCall, index: number) => FakeResponse | Error;

export function testSystem(overrides: Partial<SystemConfig> = {}): ResolvedSystem {
  return {
    ...SystemConfigSchema.parse({
      url: 'https://sap.example.com:44300',
      client: '100',
      username: 'DEVELOPER',
      password: 'secret',
      ...overrides,
    }),
    origin: 'config-file',
  };
}

function readHeaders(raw: unknown): Record<string, string> {
  const headers: Record<string, string> = {};
  if (raw && typeof (raw as Iterable<[string, string]>)[Symbol.iterator] === 'function') {
    for (const [key, value] of raw as Iterable<[string, string]>) headers[key.toLowerCase()] = value;
  } else if (raw && typeof raw === 'object') {
    for (const [key, value] of Object.entries(raw)) headers[key.toLowerCase()] = String(value);
  }
  return headers;
}

/**
 * Builds a fetch stand-in so connections can be exercised without a network.
 * The responder sees every call in order.
 */
export function fakeFetch(responder: Responder) {
  const calls: RecordedCall[] = [];

  const fetchImpl = async (input: unknown, init: Record<string, unknown> = {}) => {
    const rawUrl = typeof input === 'string' ? input : String((input as { url?: string }).url);
    const call: RecordedCall = {
      url: new URL(rawUrl),
      method: typeof init.method === 'string' ? init.method : 'GET',
      headers: readHeaders(init.headers),
      body: typeof init.body === 'string' ? init.body : undefined,
    };
    calls.push(call);

    const outcome = responder(call, calls.length - 1);
    if (outcome instanceof Error) throw outcome;

    const responseHeaders = new Headers(outcome.headers ?? {});
    for (const cookie of outcome.setCookie ?? []) responseHeaders.append('set-cookie', cookie);
    return new Response(outcome.body ?? '', { status: outcome.status ?? 200, headers: responseHeaders });
  };

  return { fetchImpl: fetchImpl as unknown as typeof globalThis.fetch, calls };
}

export interface FakeConnectionOptions {
  system?: Partial<SystemConfig>;
  /**
   * Answers the CSRF priming request for POST handlers and keeps it out of
   * `calls`, so a handler test can index the requests it actually cares about.
   * The CSRF mechanics themselves are covered in connection.test.ts.
   */
  autoCsrf?: boolean;
}

export function fakeConnection(responder: Responder, options: FakeConnectionOptions = {}) {
  const { autoCsrf = true } = options;
  const calls: RecordedCall[] = [];

  const wrapped: Responder = (call) => {
    if (autoCsrf && call.headers['x-csrf-token'] === 'fetch') {
      return { headers: { 'x-csrf-token': 'TEST-TOKEN' } };
    }
    calls.push(call);
    return responder(call, calls.length - 1);
  };

  const { fetchImpl } = fakeFetch(wrapped);
  const connection = new SapConnection('dev', testSystem(options.system), {
    fetch: fetchImpl,
    providers: [createInlineProvider()],
  });

  return { connection, calls };
}

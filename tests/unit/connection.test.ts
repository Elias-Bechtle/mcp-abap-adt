import { afterEach, describe, expect, it, vi } from 'vitest';

import { createInlineProvider } from '../../src/auth/providers/inline.js';
import { SapConnection } from '../../src/connection/SapConnection.js';
import { AdtHttpError, isHttpStatus } from '../../src/connection/errors.js';
import { ConnectionRegistry, UnknownSystemError } from '../../src/connection/registry.js';
import type { ResolvedAppConfig, ResolvedSystem, SystemConfig } from '../../src/config/schema.js';
import { fakeFetch, testSystem as system, type Responder } from '../helpers/fakeConnection.js';

/**
 * Unlike the handler tests, these exercise the CSRF and cookie mechanics
 * themselves, so every request reaches the responder.
 */
function connect(responder: Responder, overrides: Partial<SystemConfig> = {}) {
  const { fetchImpl, calls } = fakeFetch(responder);
  const connection = new SapConnection('dev', system(overrides), {
    fetch: fetchImpl,
    providers: [createInlineProvider()],
  });
  return { connection, calls };
}

describe('SapConnection requests', () => {
  it('sends Basic auth and the sap-client query parameter', async () => {
    const { connection, calls } = connect(() => ({ body: '<abap/>' }));

    const response = await connection.request('/sap/bc/adt/programs/programs/X/source/main');

    expect(response.data).toBe('<abap/>');
    expect(response.status).toBe(200);
    expect(calls[0].url.pathname).toBe('/sap/bc/adt/programs/programs/X/source/main');
    // ICF ignores the X-SAP-Client header, so the query parameter is what counts.
    expect(calls[0].url.searchParams.get('sap-client')).toBe('100');
    expect(calls[0].headers.authorization).toBe(`Basic ${Buffer.from('DEVELOPER:secret').toString('base64')}`);
  });

  it('adds sap-language only when the system configures one', async () => {
    const withLanguage = connect(() => ({ body: 'ok' }), { language: 'DE' });
    await withLanguage.connection.request('/sap/bc/adt/x');
    expect(withLanguage.calls[0].url.searchParams.get('sap-language')).toBe('DE');

    const withoutLanguage = connect(() => ({ body: 'ok' }));
    await withoutLanguage.connection.request('/sap/bc/adt/x');
    expect(withoutLanguage.calls[0].url.searchParams.has('sap-language')).toBe(false);
  });

  it('omits sap-client when the system has no client, using the system default', async () => {
    const { connection, calls } = connect(() => ({ body: 'ok' }), { client: undefined });

    await connection.request('/sap/bc/adt/x');

    expect(calls[0].url.searchParams.has('sap-client')).toBe(false);
  });

  it('passes caller query parameters through', async () => {
    const { connection, calls } = connect(() => ({ body: 'ok' }));

    await connection.request('/sap/bc/adt/x', { query: { rowNumber: 5 } });

    expect(calls[0].url.searchParams.get('rowNumber')).toBe('5');
  });
});

describe('CSRF handling', () => {
  it('fetches a token before a POST and replays it with the cookies', async () => {
    const { connection, calls } = connect((call) =>
      call.headers['x-csrf-token'] === 'fetch'
        ? {
            headers: { 'x-csrf-token': 'TOKEN-1' },
            setCookie: ['SAP_SESSIONID=abc; Path=/; HttpOnly'],
          }
        : { body: '<rows/>' },
    );

    const response = await connection.request('/sap/bc/adt/datapreview/freestyle', {
      method: 'POST',
      body: 'SELECT * FROM DD02L',
    });

    expect(response.data).toBe('<rows/>');
    expect(calls).toHaveLength(2);
    expect(calls[1].method).toBe('POST');
    expect(calls[1].headers['x-csrf-token']).toBe('TOKEN-1');
    // Only name=value belongs on the Cookie header, never the attributes.
    expect(calls[1].headers.cookie).toBe('SAP_SESSIONID=abc');
    expect(calls[1].body).toBe('SELECT * FROM DD02L');
  });

  it('takes the token from a rejected fetch response', async () => {
    const { connection, calls } = connect((call) =>
      call.headers['x-csrf-token'] === 'fetch'
        ? { status: 403, body: 'forbidden', headers: { 'x-csrf-token': 'TOKEN-FROM-ERROR' } }
        : { body: 'ok' },
    );

    await connection.request('/sap/bc/adt/x', { method: 'POST', body: 'q' });

    expect(calls[1].headers['x-csrf-token']).toBe('TOKEN-FROM-ERROR');
  });

  it('refreshes a stale token once and retries', async () => {
    let posts = 0;
    const { connection, calls } = connect((call) => {
      if (call.headers['x-csrf-token'] === 'fetch') {
        return { headers: { 'x-csrf-token': `TOKEN-${calls.length}` } };
      }
      posts += 1;
      return posts === 1 ? { status: 403, body: 'CSRF token validation failed' } : { body: 'ok' };
    });

    const response = await connection.request('/sap/bc/adt/x', { method: 'POST', body: 'q' });

    expect(response.data).toBe('ok');
    expect(posts).toBe(2);
    // token fetch, failed POST, token refetch, successful POST
    expect(calls).toHaveLength(4);
  });

  it('shares one token fetch between concurrent POSTs', async () => {
    let tokenFetches = 0;
    const { connection, calls } = connect((call) => {
      if (call.headers['x-csrf-token'] === 'fetch') {
        tokenFetches += 1;
        return { headers: { 'x-csrf-token': 'SHARED' } };
      }
      return { body: 'ok' };
    });

    // MCP clients may run tool calls in parallel; the first POSTs must not
    // each fire their own token request.
    await Promise.all([
      connection.request('/sap/bc/adt/x', { method: 'POST', body: 'a' }),
      connection.request('/sap/bc/adt/y', { method: 'POST', body: 'b' }),
      connection.request('/sap/bc/adt/z', { method: 'POST', body: 'c' }),
    ]);

    expect(tokenFetches).toBe(1);
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(3);
  });

  it('names authorization as the cause when the token request gets 403', async () => {
    const { connection } = connect((call) =>
      call.headers['x-csrf-token'] === 'fetch'
        ? { status: 403, body: 'No authorization to access resource /sap/bc/adt/datapreview/freestyle' }
        : { body: 'unreachable' },
    );

    const attempt = connection.request('/sap/bc/adt/datapreview/freestyle', { method: 'POST', body: 'q' });

    await expect(attempt).rejects.toThrow(/authorization result, not a token problem/);
    await expect(attempt).rejects.toThrow(/Gateway hub/);
  });

  it('lets a 401 during the token request reach the session recovery', async () => {
    const { connection, calls } = connect((call, index) => {
      if (index === 0) return { body: 'ok', setCookie: ['SESSION=alive; Path=/'] };
      if (call.headers['x-csrf-token'] === 'fetch') {
        // The first token request hits the dead session; the second succeeds.
        return index === 1 ? { status: 401, body: 'logon page' } : { headers: { 'x-csrf-token': 'FRESH' } };
      }
      return { body: 'recovered' };
    });

    await connection.request('/sap/bc/adt/x');
    const response = await connection.request('/sap/bc/adt/y', { method: 'POST', body: 'q' });

    expect(response.data).toBe('recovered');
    expect(calls.at(-1)?.headers['x-csrf-token']).toBe('FRESH');
  });

  it('gives up rather than retrying forever', async () => {
    const { connection } = connect((call) =>
      call.headers['x-csrf-token'] === 'fetch'
        ? { headers: { 'x-csrf-token': 'T' } }
        : { status: 403, body: 'CSRF token validation failed' },
    );

    await expect(connection.request('/sap/bc/adt/x', { method: 'POST', body: 'q' })).rejects.toBeInstanceOf(
      AdtHttpError,
    );
  });
});

/** Trimmed from a real 401 answer; SAP embeds a base64 logo of several kB. */
const LOGON_PAGE =
  '<html><head><meta http-equiv="content-type" content="text/html; charset=windows-1252">' +
  '<title>Anmeldung fehlgeschlagen</title><style>body { background: #ffffff; }</style></head>' +
  '<body><span class="errorTextHeader"> 401 Nicht autorisiert </span>' +
  "<img src='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAJYAAABQCAYAAAGMt7zd'/></body></html>";

/** Diagnostics go to stderr; stdout carries JSON-RPC and must stay untouched. */
function captureStderr(): string[] {
  const written: string[] = [];
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
    written.push(String(chunk));
    return true;
  });
  return written;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('expired sessions', () => {
  it('says on stderr that it replaced the session', async () => {
    const stderr = captureStderr();
    const { connection } = connect((_call, index) => {
      if (index === 0) return { body: 'first', setCookie: ['SESSION=alive; Path=/'] };
      return index === 1 ? { status: 401, body: 'logon page' } : { body: 'recovered' };
    });

    await connection.request('/sap/bc/adt/x');
    await connection.request('/sap/bc/adt/y');

    const output = stderr.join('');
    expect(output).toContain('session for system "dev" was rejected with 401');
    expect(output).toContain('retrying once');
  });

  it('traces each call only when MCP_ABAP_ADT_DEBUG is set', async () => {
    const quiet = captureStderr();
    const { connection } = connect(() => ({ body: 'ok' }));
    await connection.request('/sap/bc/adt/x');
    expect(quiet.join('')).toBe('');

    vi.restoreAllMocks();
    const loud = captureStderr();
    vi.stubEnv('MCP_ABAP_ADT_DEBUG', '1');
    const second = connect(() => ({ body: 'ok' }));
    await second.connection.request('/sap/bc/adt/y');

    const output = loud.join('');
    expect(output).toContain('dev GET /sap/bc/adt/y -> 200 in');
    // The Authorization header and the cookies must never be logged.
    expect(output).not.toContain('Basic ');
    expect(output).not.toContain('secret');
  });

  it('drops the dead session and retries once', async () => {
    const { connection, calls } = connect((_call, index) => {
      if (index === 0) return { body: 'first', setCookie: ['SAP_SESSIONID_T02_910=alive; Path=/; HttpOnly'] };
      if (index === 1) return { status: 401, body: LOGON_PAGE };
      return { body: 'recovered' };
    });

    await connection.request('/sap/bc/adt/x');
    const response = await connection.request('/sap/bc/adt/y');

    expect(response.data).toBe('recovered');
    expect(calls).toHaveLength(3);
    // The dead cookie was sent once, recognised, and not sent again.
    expect(calls[1].headers.cookie).toBe('SAP_SESSIONID_T02_910=alive');
    expect(calls[2].headers.cookie).toBeUndefined();
  });

  it('renews the CSRF token together with the cookies', async () => {
    let tokens = 0;
    const { connection, calls } = connect((call, index) => {
      if (call.headers['x-csrf-token'] === 'fetch') {
        tokens += 1;
        return { headers: { 'x-csrf-token': `TOKEN-${tokens}` }, setCookie: [`SESSION=s${tokens}; Path=/`] };
      }
      return index === 2 ? { status: 401, body: LOGON_PAGE } : { body: 'ok' };
    });

    await connection.request('/sap/bc/adt/x', { method: 'POST', body: 'a' });
    const response = await connection.request('/sap/bc/adt/y', { method: 'POST', body: 'b' });

    expect(response.data).toBe('ok');
    // token fetch, POST, dead POST, token refetch, successful POST
    expect(calls).toHaveLength(5);
    expect(calls[4].headers['x-csrf-token']).toBe('TOKEN-2');
    expect(calls[4].headers.cookie).toBe('SESSION=s2');
  });

  it('does not retry a 401 on a connection that never had a session', async () => {
    // Wrong password and dead session are indistinguishable by status, but a
    // fresh connection has nothing to renew: a second attempt would only add
    // to the failed-logon counter of a user whose password changed.
    const { connection, calls } = connect(() => ({ status: 401, body: LOGON_PAGE }));

    await expect(connection.request('/sap/bc/adt/x')).rejects.toThrow(/401/);
    expect(calls).toHaveLength(1);
  });

  it('reports a failed re-login readably instead of looping', async () => {
    const { connection, calls } = connect((_call, index) =>
      index === 0 ? { body: 'ok', setCookie: ['SESSION=alive; Path=/'] } : { status: 401, body: LOGON_PAGE },
    );

    await connection.request('/sap/bc/adt/x');

    await expect(connection.request('/sap/bc/adt/y')).rejects.toThrow(/re-login was rejected|no longer accepted/);
    // one live call, one dead call, exactly one retry
    expect(calls).toHaveLength(3);
  });
});

describe('error mapping', () => {
  it('turns a 404 into an AdtHttpError carrying the ADT body', async () => {
    const { connection } = connect(() => ({ status: 404, body: '<exc>not found</exc>' }));

    const error = await connection.request('/sap/bc/adt/ddic/tables/NOPE/source/main').catch((e: unknown) => e);

    expect(isHttpStatus(error, 404)).toBe(true);
    expect((error as AdtHttpError).body).toBe('<exc>not found</exc>');
  });

  it('reduces an HTML logon page to one line instead of eight kilobytes', async () => {
    const { connection } = connect(() => ({ status: 401, body: LOGON_PAGE }));

    const error: unknown = await connection.request('/sap/bc/adt/x').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AdtHttpError);
    const { body } = error as AdtHttpError;
    expect(body).toContain('Anmeldung fehlgeschlagen');
    expect(body).toContain('session or credentials');
    expect(body).not.toContain('base64');
    expect(body.length).toBeLessThan(250);
  });

  it('keeps ADT XML error bodies whole, where the detail lives', async () => {
    const { connection } = connect(() => ({
      status: 400,
      body: '<exc:exception><localizedMessage>Es ist nur eine SELECT-Anweisung zulässig</localizedMessage></exc:exception>',
    }));

    const error: unknown = await connection.request('/sap/bc/adt/x').catch((e: unknown) => e);

    const { body } = error as AdtHttpError;
    expect(body).toContain('SELECT-Anweisung');
    expect(body).toContain('<exc:exception>');
  });

  it('explains a certificate failure and points at allowSelfSigned', async () => {
    const tlsFailure = Object.assign(new TypeError('fetch failed'), {
      cause: Object.assign(new Error('self-signed certificate in chain'), {
        code: 'SELF_SIGNED_CERT_IN_CHAIN',
      }),
    });
    const { connection } = connect(() => tlsFailure);

    await expect(connection.request('/sap/bc/adt/x')).rejects.toThrow(/allowSelfSigned/);
  });
});

function registryFor(systems: Record<string, ResolvedSystem>, defaultSystem?: string, fetchImpl?: typeof fetch) {
  const config: ResolvedAppConfig = {
    defaultSystem,
    systems: new Map(Object.entries(systems)),
    errors: [],
    sources: [],
  };
  return new ConnectionRegistry(config, { fetch: fetchImpl, providers: [createInlineProvider()] });
}

describe('ConnectionRegistry', () => {
  it('reuses one connection per system', () => {
    const registry = registryFor({ dev: system() }, 'dev');

    expect(registry.get('dev')).toBe(registry.get('dev'));
  });

  it('falls back to the default system', () => {
    const registry = registryFor({ dev: system(), prd: system() }, 'prd');

    expect(registry.get().name).toBe('prd');
  });

  it('lists the configured systems without leaking secrets', () => {
    const registry = registryFor({ dev: system({ password: 'top-secret', username: 'DEVELOPER' }) }, 'dev');

    const listed = registry.listSystems();

    expect(listed).toEqual([
      {
        name: 'dev',
        url: 'https://sap.example.com:44300',
        client: '100',
        language: undefined,
        authType: 'basic',
        credentialSource: 'inline',
        allowSelfSigned: false,
        allowFreeSql: true,
        isDefault: true,
        origin: 'config-file',
      },
    ]);
    expect(JSON.stringify(listed)).not.toContain('top-secret');
  });

  it('names the available systems when asked for an unknown one', () => {
    const registry = registryFor({ dev: system(), prd: system() }, 'dev');

    expect(() => registry.get('qas')).toThrow(UnknownSystemError);
    expect(() => registry.get('qas')).toThrow(/Configured systems: dev, prd/);
  });

  it('asks for a system when there is no default', () => {
    const registry = registryFor({ dev: system(), prd: system() });

    expect(() => registry.get()).toThrow(/no default system is configured/);
  });

  it('keeps sessions of different systems apart', async () => {
    const seen: Array<{ host: string; cookie?: string }> = [];
    const fetchImpl = (async (input: unknown, init: Record<string, unknown> = {}) => {
      const url = new URL(String(input));
      const headers = new Headers((init.headers as Record<string, string>) ?? {});
      seen.push({ host: url.host, cookie: headers.get('cookie') ?? undefined });
      const responseHeaders = new Headers({ 'x-csrf-token': `TOKEN-${url.host}` });
      responseHeaders.append('set-cookie', `SESSION=${url.host}; Path=/`);
      return new Response('ok', { status: 200, headers: responseHeaders });
    }) as unknown as typeof globalThis.fetch;

    const registry = registryFor(
      {
        dev: system({ url: 'https://dev.example.com' }),
        prd: system({ url: 'https://prd.example.com' }),
      },
      'dev',
      fetchImpl,
    );

    // Prime each system's cookie jar, then post so the stored cookie is echoed.
    await registry.get('dev').request('/sap/bc/adt/x');
    await registry.get('prd').request('/sap/bc/adt/x');
    await registry.get('dev').request('/sap/bc/adt/y', { method: 'POST', body: 'q' });

    const devPost = seen.at(-1);
    expect(devPost?.host).toBe('dev.example.com');
    expect(devPost?.cookie).toBe('SESSION=dev.example.com');
    expect(seen.some((call) => call.host === 'prd.example.com' && call.cookie?.includes('dev.example.com'))).toBe(
      false,
    );
  });
});

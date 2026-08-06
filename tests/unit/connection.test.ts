import { describe, expect, it } from 'vitest';

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

describe('error mapping', () => {
  it('turns a 404 into an AdtHttpError carrying the ADT body', async () => {
    const { connection } = connect(() => ({ status: 404, body: '<exc>not found</exc>' }));

    const error = await connection.request('/sap/bc/adt/ddic/tables/NOPE/source/main').catch((e: unknown) => e);

    expect(isHttpStatus(error, 404)).toBe(true);
    expect((error as AdtHttpError).body).toBe('<exc>not found</exc>');
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

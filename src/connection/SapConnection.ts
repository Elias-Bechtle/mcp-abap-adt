import { createFetch } from 'ofetch';
import { Agent, Headers as UndiciHeaders, fetch as undiciFetch } from 'undici';

import { defaultCredentialProviders, resolveCredentials } from '../auth/resolve.js';
import type { CredentialProvider, ResolvedCredentials } from '../auth/types.js';
import type { SystemConfig } from '../config/schema.js';
import { AdtHttpError, describeTlsFailure, findHttpStatus, summarizeHtmlPage } from './errors.js';

/** An array value becomes a repeated query parameter, as ADT facets require. */
export type QueryValue = string | number | boolean | Array<string | number>;

export interface AdtRequestOptions {
  method?: 'GET' | 'POST' | 'PUT';
  query?: Record<string, QueryValue | undefined>;
  /** Raw request body. ADT speaks XML and plain text, never JSON. */
  body?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export interface AdtResponse {
  status: number;
  headers: Headers;
  data: string;
}

export interface SapConnectionDeps {
  /** Injected in tests to avoid real network access. */
  fetch?: typeof globalThis.fetch;
  providers?: CredentialProvider[];
}

/**
 * ADT error bodies are XML or plain text. Anything else would stringify to
 * "[object Object]", which tells the reader nothing.
 */
function stringifyBody(body: unknown): string {
  if (typeof body === 'string') return body;
  if (body === null || body === undefined) return '';
  try {
    return JSON.stringify(body) ?? '';
  } catch {
    return '';
  }
}

interface ExecuteOptions {
  method: 'GET' | 'POST' | 'PUT';
  extraHeaders?: Record<string, string>;
  query?: AdtRequestOptions['query'];
  body?: string;
  timeoutMs?: number;
}

/**
 * One SAP system's connection: its HTTP client, TLS policy, credentials, CSRF
 * token and cookies. Everything that used to be module-level state lives here,
 * so two systems can be used side by side without their sessions colliding.
 */
export class SapConnection {
  readonly #providers: CredentialProvider[];
  readonly #agent: Agent;
  readonly #fetcher: ReturnType<typeof createFetch>;
  #credentials?: Promise<ResolvedCredentials>;
  #csrfToken: string | null = null;
  #csrfFetch?: Promise<string>;
  #cookies = new Map<string, string>();

  constructor(
    readonly name: string,
    readonly config: SystemConfig,
    deps: SapConnectionDeps = {},
  ) {
    this.#providers = deps.providers ?? defaultCredentialProviders();
    // Certificate verification is on unless the system opts out. Pairing
    // undici's Agent with undici's own fetch keeps the dispatcher compatible;
    // mixing it with the global fetch is a known source of breakage.
    this.#agent = new Agent({ connect: { rejectUnauthorized: !config.allowSelfSigned } });
    this.#fetcher = createFetch({
      fetch: (deps.fetch ?? undiciFetch) as never,
      Headers: UndiciHeaders as never,
    });
  }

  /** Origin of the configured URL; ADT paths are absolute from the root. */
  get baseUrl(): string {
    return new URL(this.config.url).origin;
  }

  async close(): Promise<void> {
    await this.#agent.close();
  }

  async request(path: string, options: AdtRequestOptions = {}): Promise<AdtResponse> {
    // A 401 on a connection that held session cookies means SAP invalidated
    // the security session; a parallel GUI logoff by the same user is enough.
    // The credentials are usually still valid, so the dead session is dropped
    // and the call retried exactly once - more attempts would only feed the
    // failed-logon counter of a user whose password really did change.
    //
    // Whether a dead session produces a 401 at all is a system setting. It was
    // reported from one NetWeaver system, where it left every further call
    // answering with the logon page until the server restarted. On another it
    // could not be provoked: neither /sap/public/bc/icf/logoff nor a
    // deliberately corrupted session id stopped ICF from re-authenticating via
    // Basic auth and issuing a fresh session. So this path stays inert where
    // the behaviour does not occur, and the fakes in connection.test.ts are
    // what pin its logic down.
    const hadSession = this.#cookies.size > 0;
    try {
      return await this.#requestOnce(path, options);
    } catch (error) {
      if (!findHttpStatus(error, 401)) throw error;
      // Any 401 empties the credential cache, so the next attempt re-reads the
      // keychain or the environment. A rotated password then heals on the next
      // call instead of requiring a server restart. This costs nothing extra:
      // no attempt happens that would not happen anyway.
      this.#credentials = undefined;
      if (!hadSession) throw error;
      this.#resetSession();
      try {
        return await this.#requestOnce(path, options);
      } catch (retryError) {
        if (findHttpStatus(retryError, 401)) {
          throw new Error(
            `The session for system "${this.name}" had expired, and the re-login was rejected with 401. ` +
              'The stored credentials are no longer accepted: check whether the password has changed or the user is locked.',
            { cause: retryError },
          );
        }
        throw retryError;
      }
    }
  }

  async #requestOnce(path: string, options: AdtRequestOptions): Promise<AdtResponse> {
    const method = options.method ?? 'GET';
    const execute: ExecuteOptions = {
      method,
      extraHeaders: options.headers,
      query: options.query,
      body: options.body,
      timeoutMs: options.timeoutMs,
    };

    if ((method === 'POST' || method === 'PUT') && !this.#csrfToken) {
      this.#csrfToken = await this.#sharedCsrfFetch(path, options);
    }

    try {
      return await this.#execute(path, execute);
    } catch (error) {
      // ADT rejects a stale token with 403; refresh once and retry.
      if (error instanceof AdtHttpError && error.status === 403 && error.body.includes('CSRF')) {
        this.#csrfToken = await this.#sharedCsrfFetch(path, options);
        return this.#execute(path, execute);
      }
      throw error;
    }
  }

  /**
   * The CSRF token belongs to the session the cookies identify. Discarding one
   * without the other would leave a half-session behind that keeps failing,
   * which is why there is no way to clear them separately.
   */
  #resetSession(): void {
    this.#cookies.clear();
    this.#csrfToken = null;
  }

  /**
   * MCP clients may run tool calls in parallel. Without single-flighting,
   * every concurrent first POST would fire its own token request; with it,
   * they all await the same one.
   */
  #sharedCsrfFetch(path: string, options: AdtRequestOptions): Promise<string> {
    this.#csrfFetch ??= this.#fetchCsrfToken(path, options).finally(() => {
      this.#csrfFetch = undefined;
    });
    return this.#csrfFetch;
  }

  async #fetchCsrfToken(path: string, options: AdtRequestOptions): Promise<string> {
    try {
      const response = await this.#execute(path, {
        method: 'GET',
        extraHeaders: { 'x-csrf-token': 'fetch' },
        query: options.query,
        timeoutMs: options.timeoutMs,
      });
      const token = response.headers.get('x-csrf-token');
      if (token) return token;
      throw new Error('the response carried no x-csrf-token header');
    } catch (error) {
      if (error instanceof AdtHttpError) {
        // A rejected fetch still carries a usable token often enough to matter.
        const token = error.headers?.get('x-csrf-token');
        if (token) return token;
        // A 403 without a token is an authorization answer, not a token
        // problem. Wrapping it as "could not obtain a CSRF token" once sent a
        // user chasing a connection issue when the endpoint simply did not
        // exist on their Gateway hub.
        if (error.status === 403) {
          throw new Error(
            `System "${this.name}" answered 403 for ${path}. That is an authorization result, not a token problem: ` +
              'the user may lack ADT authorization for this endpoint, or the system does not offer it at all ' +
              `(a Gateway hub, for example).${error.body ? ` SAP said: ${error.body}` : ''}`,
            { cause: error },
          );
        }
        // Everything else keeps its shape - above all a 401, which the session
        // recovery in request() has to recognise.
        throw error;
      }
      throw new Error(
        `Could not obtain a CSRF token for system "${this.name}": ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }

  async #execute(path: string, options: ExecuteOptions): Promise<AdtResponse> {
    const credentials = await this.#getCredentials();
    const headers: Record<string, string> = {
      Authorization: `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64')}`,
      ...(this.config.client ? { 'X-SAP-Client': this.config.client } : {}),
      ...options.extraHeaders,
    };

    if ((options.method === 'POST' || options.method === 'PUT') && this.#csrfToken) {
      headers['x-csrf-token'] = this.#csrfToken;
    }
    const cookie = this.#cookieHeader();
    if (cookie) headers.Cookie = cookie;

    try {
      const response = await this.#fetcher.raw<string, 'text'>(path, {
        baseURL: this.baseUrl,
        method: options.method,
        headers,
        query: this.#query(options.query),
        body: options.body,
        // ADT answers with XML and plain text; never let it be parsed as JSON.
        responseType: 'text',
        retry: 0,
        timeout: options.timeoutMs ?? this.config.timeoutMs,
        dispatcher: this.#agent,
      });
      this.#storeCookies(response.headers);
      return { status: response.status, headers: response.headers, data: response._data ?? '' };
    } catch (error) {
      throw this.#mapError(error, path);
    }
  }

  #query(extra: AdtRequestOptions['query']): Record<string, QueryValue> {
    const query: Record<string, QueryValue> = {};
    // sap-client must be a query parameter; ICF ignores the X-SAP-Client header
    // and would otherwise log on to the system default client.
    if (this.config.client) query['sap-client'] = this.config.client;
    if (this.config.language) query['sap-language'] = this.config.language;
    for (const [key, value] of Object.entries(extra ?? {})) {
      if (value !== undefined) query[key] = value;
    }
    return query;
  }

  #mapError(error: unknown, path: string): Error {
    const tlsFailure = describeTlsFailure(error, this.name);
    if (tlsFailure) return tlsFailure;

    const response = (error as { response?: { status?: number; headers?: Headers; _data?: unknown } }).response;
    if (response?.status) {
      // Error responses carry cookies and CSRF tokens worth keeping.
      this.#storeCookies(response.headers);
      const raw = stringifyBody((error as { data?: unknown }).data ?? response._data);
      const htmlSummary = summarizeHtmlPage(raw);
      const body = htmlSummary
        ? response.status === 401
          ? `${htmlSummary} The session or credentials were not accepted.`
          : htmlSummary
        : raw;
      return new AdtHttpError(response.status, body, `${this.baseUrl}${path}`, response.headers);
    }
    return error instanceof Error ? error : new Error(String(error));
  }

  #storeCookies(headers: Headers | undefined): void {
    const setCookies = headers?.getSetCookie?.() ?? [];
    for (const raw of setCookies) {
      // Keep only name=value; attributes such as Path or HttpOnly must not be
      // echoed back on the Cookie request header.
      const pair = raw.split(';', 1)[0] ?? '';
      const separator = pair.indexOf('=');
      if (separator <= 0) continue;
      this.#cookies.set(pair.slice(0, separator).trim(), pair.slice(separator + 1).trim());
    }
  }

  #cookieHeader(): string {
    return [...this.#cookies].map(([name, value]) => `${name}=${value}`).join('; ');
  }

  #getCredentials(): Promise<ResolvedCredentials> {
    if (!this.#credentials) {
      const pending = resolveCredentials(this.name, this.config, this.#providers);
      this.#credentials = pending;
      // A failed lookup must not be cached, otherwise fixing the keychain or
      // the environment would require restarting the server.
      pending.catch(() => {
        if (this.#credentials === pending) this.#credentials = undefined;
      });
    }
    return this.#credentials;
  }
}

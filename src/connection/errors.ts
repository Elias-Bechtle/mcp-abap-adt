/** An ADT request that reached the server and came back with a non-2xx status. */
export class AdtHttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    readonly url: string,
    readonly headers?: Headers,
  ) {
    super(`ADT request failed with status ${status}: ${url}`);
    this.name = 'AdtHttpError';
  }
}

export function isHttpStatus(error: unknown, status: number): error is AdtHttpError {
  return error instanceof AdtHttpError && error.status === status;
}

/** TLS handshake failures that a per-system `allowSelfSigned` would resolve. */
const SELF_SIGNED_CODES = new Set([
  'SELF_SIGNED_CERT_IN_CHAIN',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

function findCertificateErrorCode(error: unknown, depth = 0): string | undefined {
  if (!error || typeof error !== 'object' || depth > 5) return undefined;
  const code = (error as { code?: unknown }).code;
  if (typeof code === 'string' && SELF_SIGNED_CODES.has(code)) return code;
  return findCertificateErrorCode((error as { cause?: unknown }).cause, depth + 1);
}

/**
 * Certificate verification is on by default, which is a change from earlier
 * versions that disabled it unconditionally. Point the user at the opt-out
 * instead of letting undici's bare "fetch failed" reach them.
 */
export function describeTlsFailure(error: unknown, systemName: string): Error | undefined {
  const code = findCertificateErrorCode(error);
  if (!code) return undefined;
  // Both configuration surfaces are named because the message must be
  // actionable for someone who has no config file at all.
  return new Error(
    `TLS certificate verification failed for system "${systemName}" (${code}). ` +
      'If this system uses a self-signed or internally issued certificate, allow it explicitly: ' +
      `add "allowSelfSigned": true to the "${systemName}" entry in your configuration file, ` +
      'or set SAP_ALLOW_SELF_SIGNED=true if you configure the server through environment variables.',
    { cause: error },
  );
}

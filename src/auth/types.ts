import type { SystemConfig } from '../config/schema.js';

export interface ResolvedCredentials {
  username: string;
  password: string;
}

/** Where a system's credentials come from. Reported by ListSystems. */
export type CredentialSource = 'inline' | 'env' | 'keychain';

export interface CredentialProvider {
  readonly id: CredentialSource;
  /** True when this system is configured to use this provider. */
  canResolve(system: SystemConfig): boolean;
  /** Returns credentials, or throws with a message explaining what is missing. */
  resolve(systemName: string, system: SystemConfig): Promise<ResolvedCredentials>;
}

/**
 * Minimal slice of the OS keychain this server needs. Keeping it behind an
 * interface lets tests run without the native module and leaves room for a
 * different backend later.
 */
export interface KeychainBackend {
  getPassword(service: string, account: string): Promise<string | null>;
  setPassword(service: string, account: string, secret: string): Promise<void>;
}

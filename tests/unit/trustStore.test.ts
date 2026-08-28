import { beforeEach, describe, expect, it } from 'vitest';

import { ensureSystemTrustStore, resetTrustStoreForTests, type TrustStoreApi } from '../../src/lib/trustStore.js';

function fakeApi(system: string[] = ['SYS-CA'], defaults: string[] = ['BUNDLED-CA', 'EXTRA-CA']) {
  const applied: string[][] = [];
  const api: TrustStoreApi = {
    getCACertificates: (type) => (type === 'system' ? system : defaults),
    setDefaultCACertificates: (certificates) => void applied.push(certificates),
  };
  return { api, applied };
}

beforeEach(() => {
  resetTrustStoreForTests();
});

describe('ensureSystemTrustStore', () => {
  it('adds the OS store to the effective default list rather than replacing it', () => {
    const { api, applied } = fakeApi(['SYS-1', 'SYS-2']);

    expect(ensureSystemTrustStore({}, api)).toBe(true);
    // On top of 'default', which carries both the bundled Mozilla list and a
    // NODE_EXTRA_CA_CERTS file: neither a public certificate nor a file-based
    // company CA may stop validating because the OS store was added.
    expect(applied).toEqual([['BUNDLED-CA', 'EXTRA-CA', 'SYS-1', 'SYS-2']]);
  });

  it('does nothing when NODE_USE_SYSTEM_CA already did it natively', () => {
    const { api, applied } = fakeApi();

    expect(ensureSystemTrustStore({ NODE_USE_SYSTEM_CA: '1' }, api)).toBe(true);
    expect(applied).toEqual([]);
  });

  it('respects the explicit opt-out', () => {
    const { api, applied } = fakeApi();

    expect(ensureSystemTrustStore({ SAP_USE_SYSTEM_CA: 'false' }, api)).toBe(false);
    expect(applied).toEqual([]);
  });

  it('changes nothing on a runtime without the APIs', () => {
    const api: TrustStoreApi = {
      getCACertificates: () => {
        throw new TypeError('tls.getCACertificates is not a function');
      },
      setDefaultCACertificates: () => undefined,
    };

    expect(ensureSystemTrustStore({}, api)).toBe(false);
  });

  it('loads once and memoises the outcome', () => {
    const { api, applied } = fakeApi();

    ensureSystemTrustStore({}, api);
    ensureSystemTrustStore({}, api);

    expect(applied).toHaveLength(1);
  });
});

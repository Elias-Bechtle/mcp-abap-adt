import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Points the home directory at an empty scratch directory for every test file.
 *
 * c12 reads a user-level .mcp-abap-adtrc, and rc9 resolves where that is from
 * XDG_CONFIG_HOME or the home directory — neither of which loadAppConfig can be
 * told about, since rc9 discards the directory c12 hands it. Without this, a
 * developer who actually uses the feature has their own configuration merged
 * into the assertions, which reads as a failing test suite. CI never noticed
 * because a fresh runner has no such file.
 *
 * `homeDir` on loadAppConfig stays the way to steer the Fiori tools store; this
 * only closes the door that goes around it.
 */
export const HERMETIC_HOME = mkdtempSync(join(tmpdir(), 'mcp-abap-adt-home-'));

process.env.HOME = HERMETIC_HOME;
process.env.USERPROFILE = HERMETIC_HOME;
process.env.XDG_CONFIG_HOME = HERMETIC_HOME;

# Changelog

All notable changes to this project will be documented in this file.

This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Entries up to and including 2.0.0 were written by hand in the
[Keep a Changelog](https://keepachangelog.com/en/1.0.0/) style. From 2.0.0
onwards they are generated from conventional commits by
[changelogen](https://github.com/unjs/changelogen) via `npm run release`, which
is why the style changes further up the file.

## v2.4.0

[compare changes](https://github.com/janfrl/mcp-abap-adt/compare/v2.3.0...v2.4.0)

### 🚀 Features

- **build:** Ship type declarations ([bddac82](https://github.com/janfrl/mcp-abap-adt/commit/bddac82))
- **server:** Give ExecuteQuery a per-call time budget ([d7558ab](https://github.com/janfrl/mcp-abap-adt/commit/d7558ab))
- **lib:** Report the database execution time with each query result ([6d0fe0c](https://github.com/janfrl/mcp-abap-adt/commit/6d0fe0c))

### 🩹 Fixes

- **connection:** Recover when SAP invalidates the security session ([5a47d59](https://github.com/janfrl/mcp-abap-adt/commit/5a47d59))
- **connection:** Reduce SAP's HTML answer pages to one line ([6ecdea9](https://github.com/janfrl/mcp-abap-adt/commit/6ecdea9))
- **connection:** Name the real cause when the CSRF prime fails ([8576afc](https://github.com/janfrl/mcp-abap-adt/commit/8576afc))
- **connection:** Re-read credentials after a 401, so a rotated password heals ([2fdc5d7](https://github.com/janfrl/mcp-abap-adt/commit/2fdc5d7))

### 📖 Documentation

- Split migration and contributing out, lead section 3 with a chooser ([988cf98](https://github.com/janfrl/mcp-abap-adt/commit/988cf98))
- Describe the session recovery and the ExecuteQuery time budget ([2520cf3](https://github.com/janfrl/mcp-abap-adt/commit/2520cf3))
- **connection:** Record that the 401 session path is system-dependent ([227d515](https://github.com/janfrl/mcp-abap-adt/commit/227d515))

### ❤️ Contributors

- Jan Fröhlich ([@janfrl](https://github.com/janfrl))

## v2.3.0

[compare changes](https://github.com/janfrl/mcp-abap-adt/compare/v2.2.0...v2.3.0)

### 🚀 Features

- **config:** Name the unused Fiori systems when nothing is configured ([4810cb4](https://github.com/janfrl/mcp-abap-adt/commit/4810cb4))

### 📖 Documentation

- Tell readers to use --scope user, and point at the rc file ([8bd7ffe](https://github.com/janfrl/mcp-abap-adt/commit/8bd7ffe))
- Trim the note on Claude Code's server scopes ([04d06fc](https://github.com/janfrl/mcp-abap-adt/commit/04d06fc))
- Lead the client examples with the keychain, not a plaintext password ([07977fb](https://github.com/janfrl/mcp-abap-adt/commit/07977fb))

### ❤️ Contributors

- Jan Fröhlich ([@janfrl](https://github.com/janfrl))

## v2.2.0

[compare changes](https://github.com/janfrl/mcp-abap-adt/compare/v2.1.0...v2.2.0)

### 🚀 Features

- **config:** Configure everything without a file ([71118bf](https://github.com/janfrl/mcp-abap-adt/commit/71118bf))
- **config:** Accept a client that an rc file coerced into a number ([324674f](https://github.com/janfrl/mcp-abap-adt/commit/324674f))

### 🩹 Fixes

- **cli:** Report a malformed --config-json through ListSystems ([643325a](https://github.com/janfrl/mcp-abap-adt/commit/643325a))

### 💅 Refactors

- **config:** Let c12 apply the command line and environment layer ([3aff262](https://github.com/janfrl/mcp-abap-adt/commit/3aff262))

### 📖 Documentation

- Fix three stale or misplaced passages ([34ce1c4](https://github.com/janfrl/mcp-abap-adt/commit/34ce1c4))

### ❤️ Contributors

- Jan Fröhlich ([@janfrl](https://github.com/janfrl))

## v2.1.0

[compare changes](https://github.com/janfrl/mcp-abap-adt/compare/v2.0.0...v2.1.0)

### 🚀 Features

- **lib:** Parse and compact the ADT data preview payload ([59adda2](https://github.com/janfrl/mcp-abap-adt/commit/59adda2))
- **config:** Add allowFreeSql, on by default ([2742e01](https://github.com/janfrl/mcp-abap-adt/commit/2742e01))
- **server:** Add ExecuteQuery and return table data as CSV ([db1e1af](https://github.com/janfrl/mcp-abap-adt/commit/db1e1af))

### 🩹 Fixes

- **lib:** Treat a missing totalRows as unknown rather than zero ([975aca4](https://github.com/janfrl/mcp-abap-adt/commit/975aca4))
- **lib:** State the row total only when rows were actually withheld ([3019946](https://github.com/janfrl/mcp-abap-adt/commit/3019946))

### 📖 Documentation

- Correct where the config file is looked up ([737cb46](https://github.com/janfrl/mcp-abap-adt/commit/737cb46))
- Document ExecuteQuery, the CSV output and allowFreeSql ([ffdc1a0](https://github.com/janfrl/mcp-abap-adt/commit/ffdc1a0))

### ❤️ Contributors

- Jan Fröhlich ([@janfrl](https://github.com/janfrl))

## [2.0.0] - 2026-08-06

First release of the [janfrl](https://github.com/janfrl/mcp-abap-adt) fork,
published as `@janfr/mcp-abap-adt`.

### Added
- Support for several SAP systems at once. Systems are named in a config file
  (`mcp-abap-adt.config.{jsonc,yaml,ts,...}`) found in the working directory or
  given explicitly via `--config` or `MCP_ABAP_ADT_CONFIG`, and every tool takes
  an optional `system` argument.
- `ListSystems` tool reporting the configured systems, the default one and any
  configuration problems, without exposing credentials.
- Credentials from the OS keychain, using the same entries as the SAP Fiori
  tools VS Code extension, plus `passwordEnv` for environment references.
- `importFioriSystems` adopts systems already saved in SAP Fiori tools,
  including their stored passwords. A config entry with the same name overrides
  individual settings on an imported system instead of replacing it, so
  allowing a certificate does not mean repeating its url and client.
- `ListSystems` reports each system's `origin` (`config-file`, `fiori-tools` or
  `environment`), which is where a change has to be made.
- `SAP_ALLOW_SELF_SIGNED` mirrors the `allowSelfSigned` config key in name and
  polarity. `TLS_REJECT_UNAUTHORIZED` still works as a deprecated alias and
  warns; it was inverted and looked like Node's own variable without being it.
- `store-credentials` subcommand for writing a password to the OS keychain
  without VS Code.
- Per-system `allowSelfSigned`, `timeoutMs` and `language` settings.
- GitHub Actions CI building and testing on Node 22 and 24, on Linux and
  Windows, with oxlint (including type-aware rules) and an oxfmt format check.
- `npm run typecheck` covers the tests as well, which the build config excludes
  and vitest only transpiles.

### Changed
- Tools are registered through `McpServer.registerTool` with zod schemas,
  replacing the hand-maintained JSON schemas and dispatch switch.
- HTTP goes through ofetch on undici instead of axios; configuration loading
  uses c12 instead of dotenv; tests run on vitest instead of jest.
- Connection state (CSRF token, cookies, credentials, TLS policy) is per
  system rather than module-global, so two systems cannot corrupt each other's
  session.
- The server starts even when the configuration is broken and explains the
  problem through `ListSystems`, instead of exiting before the MCP handshake.
- The advertised server version comes from package.json instead of a hardcoded
  `0.1.0`.

### Fixed
- `SAP_LANGUAGE` and `TLS_REJECT_UNAUTHORIZED` are honoured. Both were
  documented but read nowhere.
- `GetPackage` no longer encodes the package name twice, which broke
  namespaced packages such as `/DMO/FLIGHT`.
- Cookies are echoed as `name=value` pairs instead of whole `Set-Cookie`
  strings including their attributes.

### Removed
- axios, dotenv, jest and ts-jest. Build tooling moved out of `dependencies`,
  where it was being installed at runtime.

### Breaking
- Requires Node.js 22 or newer, and the package is ESM-only.
- TLS certificates are verified. Earlier versions disabled verification
  unconditionally; systems with self-signed certificates now need
  `allowSelfSigned` or `TLS_REJECT_UNAUTHORIZED=0`.
- Handler functions take a connection as their first argument.

## [1.1.0] - 2025-02-19

### Added
- New `GetTransaction` tool to retrieve ABAP transaction details.
  - Allows fetching transaction details using the ADT endpoint `/sap/bc/adt/repository/informationsystem/objectproperties/values`.
  - Added documentation in README.md.

## [0.1.2] - 2025-02-18

### Changed
- Added Jest Test Script `index.test.ts` available through `npm test`
- Enhanced `makeAdtRequest` method to support:
  - Custom headers through an optional parameter
  - Query parameters through an optional `params` parameter
- Improved `handleGetPackage` method to use ADT's nodeContent API
  - Now uses POST request with proper XML payload
  - Added specific content type headers for nodeContent endpoint
  - Added filtering to return only objects with URI 
- Improved CSRF token handling in utils.ts
  - Added automatic CSRF token fetching for POST/PUT requests
  - Enhanced token extraction to work with error responses
  - Added cookie management for better session handling
  - Implemented singleton axios instance for consistent state
  - Added proper cleanup for test environments

## [0.1.1] - 2025-02-13

### Added
- New `GetInterface` tool to retrieve ABAP interface source code
  - Allows fetching source code of ABAP interfaces using the ADT endpoint `/sap/bc/adt/oo/interfaces/`
  - Similar functionality to GetClass but for interfaces
  - Added documentation in README.md

## [0.1.0] - Initial Release

### Added
- Initial release of the MCP ABAP ADT server
- Basic ABAP object retrieval functionality
- Support for programs, classes, function modules, and more
- Documentation and setup instructions

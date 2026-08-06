# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] - 2026-08-06

First release of the [janfrl](https://github.com/janfrl/mcp-abap-adt) fork,
published as `@janfrl/mcp-abap-adt`.

### Added
- Support for several SAP systems at once. Systems are named in a config file
  discovered by c12 (`mcp-abap-adt.config.{jsonc,yaml,ts,...}`, rc files,
  `~/.config/mcp-abap-adt/`, `--config`, `MCP_ABAP_ADT_CONFIG`), and every tool
  takes an optional `system` argument.
- `ListSystems` tool reporting the configured systems, the default one and any
  configuration problems, without exposing credentials.
- Credentials from the OS keychain, using the same entries as the SAP Fiori
  tools VS Code extension, plus `passwordEnv` for environment references.
- `importFioriSystems` adopts systems already saved in SAP Fiori tools,
  including their stored passwords.
- `store-credentials` subcommand for writing a password to the OS keychain
  without VS Code.
- Per-system `allowSelfSigned`, `timeoutMs` and `language` settings.
- GitHub Actions CI building and testing on Node 22 and 24, on Linux and
  Windows.

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

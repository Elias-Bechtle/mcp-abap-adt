# mcp-abap-adt

An MCP server that lets tools like [Claude Code](https://claude.com/claude-code), [Claude Desktop](https://claude.com/download) or [Cline](https://marketplace.visualstudio.com/items?itemName=saoudrizwan.claude-dev) read from your SAP ABAP systems through ADT (ABAP Development Tools): program and class sources, table structures and contents, CDS views, packages, and more.

This is a fork of [mario-andreschak/mcp-abap-adt](https://github.com/mario-andreschak/mcp-abap-adt) that adds:

- **Several SAP systems at once** — name them in a config file and pick one per tool call.
- **No passwords in files** — read credentials from the OS keychain, sharing entries with the SAP Fiori tools VS Code extension, or from environment variables.
- **Certificate verification on by default**, with a per-system opt-out.

## Contents

1. [Requirements](#1-requirements)
2. [Installation](#2-installation)
3. [Configuring SAP systems](#3-configuring-sap-systems)
4. [Credentials](#4-credentials)
5. [Connecting an MCP client](#5-connecting-an-mcp-client)
6. [Available tools](#6-available-tools)
7. [Troubleshooting](#7-troubleshooting)
8. [Migrating from mario-andreschak/mcp-abap-adt](#8-migrating-from-mario-andreschakmcp-abap-adt)
9. [Development](#9-development)

## 1. Requirements

- **Node.js 22 or newer.** Check with `node -v`.
- **An SAP ABAP system reachable over HTTP(S)** with the ADT services active. Your basis administrator can activate `/sap/bc/adt` in transaction `SICF`. You also need a user with the authorizations to read the objects you ask for.

## 2. Installation

Most MCP clients run the server for you; you rarely start it by hand. Point your client at:

```bash
npx -y @janfr/mcp-abap-adt
```

To install it globally instead:

```bash
npm install -g @janfr/mcp-abap-adt
```

### From source

```bash
git clone https://github.com/janfrl/mcp-abap-adt
cd mcp-abap-adt
npm install
npm run build
```

Then point your client at `node` with the absolute path to `dist/index.js`.

## 3. Configuring SAP systems

There are two ways to configure systems, and they can be combined.

### Environment variables (single system)

Setting all four of these gives you one system named `default`, which is what tool calls use when they don't name a system:

| Variable | Required | Meaning |
| --- | --- | --- |
| `SAP_URL` | yes | Base URL, e.g. `https://sap.example.com:44300` |
| `SAP_USERNAME` | yes | SAP user |
| `SAP_PASSWORD` | yes | Password |
| `SAP_CLIENT` | yes | Three digit client, e.g. `100` |
| `SAP_LANGUAGE` | no | Logon language, e.g. `EN` |
| `SAP_ALLOW_SELF_SIGNED` | no | `true` accepts self-signed or internally issued certificates |

Every `SAP_*` variable sets one field of the system named `default`, and each has the same name and meaning as the corresponding config-file key.

> `TLS_REJECT_UNAUTHORIZED=0` from earlier versions still works and means the same as `SAP_ALLOW_SELF_SIGNED=true`, but it prints a deprecation warning. The old name is inverted (`0` means "allow") and looks like Node's `NODE_TLS_REJECT_UNAUTHORIZED`, which it is not.

The variables can come from your MCP client's `env` block or from a `.env` file. Two locations are read: the directory the server is started in, and the package's own directory (where earlier versions kept it). A variable that is already set in the real environment wins over any `.env` file.

### Config file (any number of systems)

Create `mcp-abap-adt.config.jsonc` in the directory your MCP client starts the server in, or point at it explicitly with `--config <path>` or the `MCP_ABAP_ADT_CONFIG` environment variable. JSON, JSONC, YAML, TOML and `.ts` files all work, as do `~/.config/mcp-abap-adt/` and `.mcp-abap-adtrc`.

```jsonc
{
  // Used when a tool call omits the "system" argument.
  "defaultSystem": "dev",

  // Adopt systems saved by the SAP Fiori tools VS Code extension.
  "importFioriSystems": true,

  "systems": {
    "dev": {
      "url": "https://dev.example.com:44300",
      "client": "100",
      "username": "DEVELOPER",
      "keychain": true
    },
    "qas": {
      "url": "https://qas.example.com:44300",
      "client": "200",
      "username": "DEVELOPER",
      "passwordEnv": "SAP_QAS_PASSWORD"
    },
    "sandbox": {
      "url": "https://vhcalnplci.dummy.nodomain:44300",
      "client": "001",
      "username": "DEVELOPER",
      "keychain": true,
      "allowSelfSigned": true,
      "language": "EN"
    }
  }
}
```

Per-system options:

| Option | Default | Meaning |
| --- | --- | --- |
| `url` | required | Base URL of the system |
| `client` | — | Three digit client. Omitted means the system default client. |
| `language` | — | Logon language |
| `username` | — | SAP user. May also come from the keychain entry. |
| `keychain` | `false` | Read the password from the OS keychain |
| `passwordEnv` | — | Name of an environment variable holding the password |
| `password` | — | Plaintext password. Works, but warns on startup. |
| `allowSelfSigned` | `false` | Accept untrusted certificates for this system |
| `timeoutMs` | `30000` | Request timeout |
| `authType` | `basic` | Only Basic authentication is implemented |

**Which system is the default?** In order: the `defaultSystem` you declared, then a system named `default` created from the `SAP_*` variables, then the only system if there is exactly one. Otherwise every tool call must name a system, and calls that don't get an error listing the valid names.

### Adjusting an imported system

A config-file entry whose name matches an imported system is treated as an **override**: you only name what differs, and the imported `url`, `client` and `keychain` settings stay. This is how you allow an internally issued certificate on a system that came from SAP Fiori tools:

```jsonc
{
  "importFioriSystems": true,
  "systems": {
    // DNG001 keeps its imported url and client; only this one setting changes.
    "DNG001": { "allowSelfSigned": true }
  }
}
```

Spelling out `url` turns the entry into a full definition that replaces the imported one. If an override is invalid, the imported system stays usable and `ListSystems` reports that the override was ignored — a typo in one setting should not cost you access to the system.

The `SAP_*` variables only ever build the system named `default`; they do not affect imported or config-file systems.

Ask the model to call **`ListSystems`** at any time to see what the server actually resolved, including each system's `origin` (`config-file`, `fiori-tools` or `environment`) and any configuration problems. It returns no credentials.

## 4. Credentials

The server looks for a password in this order and uses the first one that applies: `password`, then `passwordEnv`, then the keychain.

### OS keychain (recommended)

Credentials live in the Windows Credential Manager, the macOS Keychain or libsecret — never in a file. The entries use the same naming as the SAP Fiori tools VS Code extension (service `fiori/v2/system`, account `<url>[/<client>]`), so the two tools share one entry.

If you already saved a system in **SAP Fiori tools**, you are done: set `"importFioriSystems": true` and the server picks up the system *and* its password. Systems using an authentication type other than basic are skipped with an explanatory message.

Otherwise store the password yourself:

```bash
mcp-abap-adt store-credentials --system dev
```

It asks for the username and a password that is not echoed. An entry that already exists is only replaced after you confirm, because it may be one the Fiori tools extension wrote.

### Environment variable

Name the variable in the config and let your MCP client provide it:

```jsonc
{ "systems": { "qas": { "url": "...", "client": "200", "username": "DEVELOPER", "passwordEnv": "SAP_QAS_PASSWORD" } } }
```

### A note on OAuth

On-premise ADT does not accept OAuth bearer tokens. `/sap/bc/adt` is a plain ICF node, while OAuth scopes in AS ABAP are a Gateway/OData construct, so there is nothing to authenticate against. OAuth would only be possible against the BTP ABAP Environment, which this server does not support yet. For on-premise systems, the keychain is the way to keep passwords out of files.

## 5. Connecting an MCP client

All clients follow the same shape. The examples show the simple single-system setup; to use several systems, drop the `env` block and add a config file instead.

### Claude Code

```bash
claude mcp add mcp-abap-adt \
  --env SAP_URL=https://sap.example.com:44300 \
  --env SAP_USERNAME=your_username \
  --env SAP_PASSWORD=your_password \
  --env SAP_CLIENT=100 \
  -- npx -y @janfr/mcp-abap-adt
```

Or commit a `.mcp.json` in your project root. Because that file is shared, reference variables rather than writing secrets into it — Claude Code expands `${VAR}`:

```json
{
  "mcpServers": {
    "mcp-abap-adt": {
      "command": "npx",
      "args": ["-y", "@janfr/mcp-abap-adt", "--config", "./mcp-abap-adt.config.jsonc"],
      "env": { "SAP_QAS_PASSWORD": "${SAP_QAS_PASSWORD}" }
    }
  }
}
```

### Claude Desktop

Settings → Developer → Edit Config, then add:

```json
{
  "mcpServers": {
    "mcp-abap-adt": {
      "command": "npx",
      "args": ["-y", "@janfr/mcp-abap-adt"],
      "env": {
        "SAP_URL": "https://sap.example.com:44300",
        "SAP_USERNAME": "your_username",
        "SAP_PASSWORD": "your_password",
        "SAP_CLIENT": "100"
      }
    }
  }
}
```

Restart Claude Desktop afterwards. On Windows, use `"command": "npx.cmd"` if `npx` is not found.

### Cline

Same JSON, in `cline_mcp_settings.json` (VS Code settings → "Cline MCP Settings" → Edit in settings.json).

Since Cline runs inside VS Code, this is where sharing credentials with SAP Fiori tools pays off: save the system once in Fiori tools, then use a config file with `"importFioriSystems": true` and no `env` block at all.

## 6. Available tools

Every tool below takes an optional **`system`** argument naming a configured system. Omit it to use the default.

| Tool | Description | Arguments |
| --- | --- | --- |
| `ListSystems` | List configured systems, the default, and configuration problems. Returns no credentials. | — |
| `GetProgram` | ABAP program source | `program_name` |
| `GetClass` | ABAP class source | `class_name` |
| `GetInterface` | ABAP interface source | `interface_name` |
| `GetFunctionGroup` | Function group source | `function_group` |
| `GetFunction` | Function module source | `function_name`, `function_group` |
| `GetInclude` | Include source | `include_name` |
| `GetStructure` | DDIC structure | `structure_name` |
| `GetTable` | Table structure | `table_name` |
| `GetTableContents` | Table contents | `table_name`, `max_rows` (default 100) |
| `GetPackage` | Package contents | `package_name` |
| `GetTypeInfo` | Domain or data element | `type_name` |
| `GetCDSView` | CDS view (DDL source) | `cds_view_name` |
| `GetTransaction` | Transaction details | `transaction_name` |
| `SearchObject` | Quick search across objects | `query`, `maxResults` (default 100) |
| `GetBehaviorDefinition` | RAP behavior definition (needs ~NW 7.54 / S/4HANA) | `behavior_definition_name` |
| `GetServiceDefinition` | RAP service definition (needs ~NW 7.54 / S/4HANA) | `service_definition_name` |

## 7. Troubleshooting

**Start with `ListSystems`.** It reports every configuration problem the server found, and it works even when nothing is configured correctly.

**"TLS certificate verification failed"** — the system's certificate is not trusted by the server process. Before switching verification off, check the next entry: in a company network the certificate is usually fine and only the trust store is missing.

If the certificate genuinely cannot be validated, add `"allowSelfSigned": true` to that system, or set `SAP_ALLOW_SELF_SIGNED=true` if you configure through environment variables. For a system that came from SAP Fiori tools, add an [override entry](#adjusting-an-imported-system) rather than redeclaring it. Version 1.x disabled verification for everyone; this version makes it a per-system decision.

**Certificates work in your shell but not through your MCP client** — MCP clients do not hand the server your whole environment. They pass a small fixed list (`PATH`, `APPDATA`, `USERPROFILE`, `TEMP` and a few more), so anything you rely on for certificate trust is silently dropped.

This bites in company networks, where the SAP certificate is issued by an internal CA that the operating system trusts but Node's bundled CA list does not. Node only consults the OS trust store when told to, so pass that setting explicitly in the client's `env` block:

```json
{
  "mcpServers": {
    "mcp-abap-adt": {
      "command": "node",
      "args": ["C:/path/to/mcp-abap-adt/dist/index.js", "--config", "C:/path/to/mcp-abap-adt.config.jsonc"],
      "env": { "NODE_USE_SYSTEM_CA": "1" }
    }
  }
}
```

This keeps verification on and validates the real certificate chain, which is strictly better than `allowSelfSigned`. The same applies to `NODE_EXTRA_CA_CERTS` if your CA bundle lives in a file.

**"No keychain entry for system ..."** — run `mcp-abap-adt store-credentials --system <name>`, or save the system in SAP Fiori tools. Note that the entry is keyed by URL *and* client, so `https://host` and `https://host/100` are different entries.

**"No system was given and no default system is configured"** — you have more than one system and no `defaultSystem`. Either set one or pass `system` in the call.

**SAP returns 401 or 403** — check the user and client, and that the user may use ADT. Some ADT endpoints need `S_DEVELOP` authorizations.

**Nothing works and you want to poke at it directly** — set `MCP_ABAP_ADT_DEBUG=1` for extra stderr diagnostics, or drive the server with the [MCP Inspector](https://github.com/modelcontextprotocol/inspector):

```bash
npm run inspect
```

That builds first and opens the inspector's web UI against the freshly built server. `npm run inspect:cli` does the same without a browser, which is handy for a quick check:

```bash
npm run inspect:cli -- --method tools/list
npm run inspect:cli -- --method tools/call --tool-name ListSystems
npm run inspect:cli -- --method tools/call --tool-name GetProgram --tool-arg program_name=RSABAPPROGRAM
```

Both pick up the config file from the working directory, so run them from the project root.

The inspector spawns the server the same way a real MCP client does, **including the reduced set of environment variables**. That makes it a faithful reproduction rather than a friendlier environment: if a certificate fails in your client, it fails here too. Add the variable the same way the client would:

```bash
npm run inspect:cli -- -e NODE_USE_SYSTEM_CA=1 --method tools/call --tool-name GetProgram --tool-arg program_name=RSABAPPROGRAM
```

## 8. Migrating from mario-andreschak/mcp-abap-adt

This fork continues from [mario-andreschak/mcp-abap-adt](https://github.com/mario-andreschak/mcp-abap-adt) 1.2.0. All 16 tools keep their names and arguments, so prompts and workflows built against the original keep working.

### The minimum change

Point your MCP client at the new package name. Everything else can stay as it is:

```diff
 {
   "mcpServers": {
     "mcp-abap-adt": {
       "command": "npx",
-      "args": ["-y", "mcp-abap-adt"],
+      "args": ["-y", "@janfr/mcp-abap-adt"],
       "env": {
         "SAP_URL": "https://sap.example.com:44300",
         "SAP_USERNAME": "your_username",
         "SAP_PASSWORD": "your_password",
         "SAP_CLIENT": "100"
       }
     }
   }
 }
```

Your four `SAP_*` variables continue to work and now describe a system named `default`, which every tool call uses unless it names another one.

### What can break, and what to do about it

| Change | Symptom | Fix |
| --- | --- | --- |
| Certificates are verified | `TLS certificate verification failed ... (SELF_SIGNED_CERT_IN_CHAIN)` on the first tool call | Add `SAP_ALLOW_SELF_SIGNED=true` to the `env` block, or `"allowSelfSigned": true` to the system in a config file |
| Node.js 22 or newer required | The server fails to start | Update Node.js; the package is also ESM-only now |
| Package renamed | The old name keeps installing the original project | Use `@janfr/mcp-abap-adt` |
| `SAP_LANGUAGE` is honoured | ABAP texts arrive in a different language than before | Remove the variable, or set it to the language you want |

The certificate change is the one that will actually bite you. Version 1.2.0 passed `rejectUnauthorized: false` on every request and never read the `TLS_REJECT_UNAUTHORIZED` variable it documented, so **no** certificate was ever checked. Verification is now on by default and can be switched off per system.

`SAP_LANGUAGE` has the same history: documented, never read. Requests that used to run in the user's default logon language now use the configured one.

### Worth adopting afterwards

None of this is required, but it is why the fork exists:

1. **Several systems at once.** Replace the `env` block with a [config file](#config-file-any-number-of-systems) and pass `system` on a tool call to pick one. `ListSystems` shows what the server resolved.
2. **No password in a file.** If you use the SAP Fiori tools VS Code extension, set `"importFioriSystems": true` and your saved systems, including their passwords, are picked up from the OS keychain. Otherwise run `mcp-abap-adt store-credentials --system <name>` once. See [Credentials](#4-credentials).
3. **Drop the `.env` file.** It still works from the package directory and the working directory, but a config file with keychain credentials leaves no secret on disk.

### Also fixed along the way

- `GetPackage` encoded the package name twice, which broke namespaced packages such as `/DMO/FLIGHT`.
- Cookies were sent back including their attributes rather than as `name=value` pairs.
- Build tooling (TypeScript, Jest) shipped in `dependencies` and was installed at runtime by every `npx` invocation.
- The server reported itself as version `0.1.0` regardless of the released version.
- A missing environment variable killed the process before the MCP handshake, which clients could only show as an opaque startup failure. Configuration problems are now reported through `ListSystems`.

## 9. Development

```bash
npm install
npm run build        # compile to dist/
npm test             # unit tests, no SAP system needed
npm run typecheck
npm run lint         # oxlint, including type-aware rules
npm run lint:fix
npm run fmt          # oxfmt; fmt:check verifies without writing
npm run inspect      # build, then the MCP Inspector web UI
npm run inspect:cli  # same without a browser, see Troubleshooting for examples
```

Two dependencies are deliberately held back, so a routine "everything to latest" pass does not undo them. `@types/node` tracks the oldest supported Node (the `engines` floor of 22) rather than the newest that exists: typing against a newer major would let the compiler accept APIs that are missing at runtime on that floor. `c12` stays on its 3.x line because 4.x is still a prerelease.

The inspector is run through `npx` rather than installed: it pulls in React, Vite and around twenty other packages that CI would otherwise download on every matrix job for a tool CI never uses. The major version is pinned in the script, because the argument order changed between its 1.x and 2.x lines.

The unit tests mock HTTP and the keychain, so they run anywhere. The integration suite talks to a real system and is opt-in:

```bash
RUN_INTEGRATION=1 npm test               # bash
$env:RUN_INTEGRATION='1'; npm test       # PowerShell
```

Set `INTEGRATION_SYSTEM` to target a specific configured system.

## License

MIT. Originally created by [mario-andreschak](https://github.com/mario-andreschak/mcp-abap-adt).

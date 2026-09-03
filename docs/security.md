# Security model

The short version: this server cannot write to a SAP system, credentials never touch a file, certificate verification is always on, and the real boundary on what can be read is the SAP authorization of the configured user. The sections below give the reasoning for anyone who wants to verify rather than trust.

## Read-only by design

There are no writing tools to call — a model cannot invoke what does not exist, which is a stronger guarantee than any runtime check. For the free SQL tool the defence is layered: SAP itself embeds the statement in `... INTO TABLE @DATA(...) UP TO n ROWS`, so anything but a query is a syntax error; SAP rejects a second statement in the same request; and this server additionally requires the text to start with `SELECT` or `WITH`. Every query runs under the SAP authorizations of the configured user.

Turning `allowFreeSql` off deserves a clear-eyed look at what it achieves: `GetTableContents` still works and reads whole tables with `SELECT *`, so switching free SQL off makes a model read **more** data, not less — projection and filtering are what keep answers small. It is worth doing only where any unplanned query is unwelcome for its own sake.

`store-credentials`, `doctor` and `setup` are CLI subcommands, not MCP tools: a model cannot invoke them.

Several read-only tools use POST, which is worth naming before it looks like an oversight. ADT expects a payload in the request body for some reads, so the method says nothing about the effect: `ExecuteQuery` and `GetTableContents` POST a SELECT, `GetWhereUsed` POSTs a fixed body and names its target in the query string, and `CheckSyntax` POSTs the source text to be checked — which is the point, since it checks text the caller supplies rather than what is stored, and nothing is saved or activated.
## Why `importFioriSystems` is off by default

Turning it on gives a model read access to every system you have saved in SAP Fiori tools, production among them — that is a decision to make, not to inherit. To keep the option findable anyway, a server with nothing configured names the systems it could have adopted:

```
No SAP system is configured. 2 systems saved by the SAP Fiori tools VS Code
extension could be used (DEV100, PRD400): set "importFioriSystems": true ...
```

Only the store's metadata is read for that, never a credential.

## TLS and the trust stores

Verification is always on; `allowSelfSigned` is a per-system last resort that switches it off for that one system.

Node normally validates against its own bundled CA list and ignores the operating system's trust store — which is why a certificate from a company CA fails in Node while every browser on the same machine accepts it. This server therefore loads the OS trust store itself at startup, additively: Node's bundled list, plus whatever `NODE_EXTRA_CA_CERTS` contributed, plus the OS store. Trust only ever widens to CAs the operating system already accepts; verification itself never weakens.

Knobs and edge cases:

- `SAP_USE_SYSTEM_CA=false` restricts the server to Node's bundled list, for anyone who deliberately wants that.
- The runtime APIs for this arrived during Node 22. On an older patch level nothing changes, `doctor` says so under its table, and `"NODE_USE_SYSTEM_CA": "1"` in the client's `env` block is the equivalent fix.
- `NODE_EXTRA_CA_CERTS` keeps working for a CA bundle that lives in a file.
- For anyone embedding the server as a library: loading happens where connections are constructed and is process-global, the same effect as `NODE_USE_SYSTEM_CA=1`.

## Why not OAuth

On-premise ADT does not accept OAuth bearer tokens. `/sap/bc/adt` is a plain ICF node, while OAuth scopes in AS ABAP are a Gateway/OData construct, so there is nothing to authenticate against. OAuth would only be possible against the BTP ABAP Environment, which this server does not support yet. For on-premise systems, the OS keychain is the way to keep passwords out of files.

## Login attempts and SAP lock counters

Failed logons count towards a user lock, so the server is deliberately stingy with attempts: an expired session is retried exactly once, a fresh connection rejected with 401 is not retried at all, `doctor` probes reachability without credentials (a request carrying no Authorization header cannot be attributed to any user), and `doctor --login` makes exactly one authenticated call per system, only on request. Storing credentials never attempts a logon.

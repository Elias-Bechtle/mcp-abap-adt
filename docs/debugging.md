# Debugging

## Tracing every ADT call

Set `MCP_ABAP_ADT_DEBUG=1` and every ADT call appears with its status and duration, which is what makes the server's own retries visible:

```
[mcp-abap-adt] DEV GET /sap/bc/adt/discovery -> 200 in 183ms
[mcp-abap-adt] DEV GET /sap/bc/adt/discovery -> 401 in 23ms
[mcp-abap-adt] session for system "DEV" was rejected with 401; dropped it and retrying once.
[mcp-abap-adt] DEV GET /sap/bc/adt/discovery -> 200 in 78ms
```

Credentials, cookies and query bodies are never logged. The session line appears without the flag as well, since a replaced session explains an extra request that would otherwise look like a hiccup.

The messages travel on two channels. They go to stderr, and they go to your MCP client through the protocol's own logging capability — which is where you are more likely to see them than in a log file you have to go find; the MCP Inspector shows them in its log pane. Note the direction of the gates: `MCP_ABAP_ADT_DEBUG` decides whether trace lines exist at all, on both channels — a client's `logging/setLevel` can only narrow down what an enabled server emits, not turn tracing on. stderr stays the fallback, because it works before the handshake and whatever the client does with notifications.

## Driving the server directly with the MCP Inspector

```bash
npm run inspect
```

That builds first and opens the [MCP Inspector](https://github.com/modelcontextprotocol/inspector)'s web UI against the freshly built server. `npm run inspect:cli` does the same without a browser, which is handy for a quick check:

```bash
npm run inspect:cli -- --method tools/list
npm run inspect:cli -- --method tools/call --tool-name ListSystems
npm run inspect:cli -- --method tools/call --tool-name GetProgram --tool-arg program_name=RSABAPPROGRAM
```

Both pick up the config file from the working directory, so run them from the project root.

The inspector spawns the server the same way a real MCP client does, **including the reduced set of environment variables**. That makes it a faithful reproduction rather than a friendlier environment: whatever fails in your client fails here too. Variables go in the same way a client would pass them:

```bash
npm run inspect:cli -- -e SAP_DEFAULT_SYSTEM=dev --method tools/call --tool-name GetProgram --tool-arg program_name=RSABAPPROGRAM
```

# One configuration for every client — and for a whole team

Two mechanisms build on each other here: a user-level rc file that every MCP client on the machine reads, and a `setup` command that fills it from a shared team list.

## The user-level rc file: `.mcp-abap-adtrc`

Settings in a user-level `.mcp-abap-adtrc` apply to every client on the machine, which is otherwise not possible: a client spawns the server with a filtered environment, so a system-wide `MCP_ABAP_ADT_CONFIG` never reaches it and each client would need its own copy of the settings.

The file lives in `$XDG_CONFIG_HOME` if you have that variable set, otherwise in your home directory. It holds flat `key=value` lines rather than JSON, nesting through dots:

```ini
defaultSystem=dev
importFioriSystems=true
systems.dev.url=https://dev.example.com:44300
systems.dev.client=100
systems.dev.keychain=true
```

Everything else — a config file in the working directory, the environment, the command line — takes precedence over it, in that order.

## Onboarding a whole team: `setup --from`

Because passwords live in the keychain, the system list itself contains no secrets — so it can be shared. Put a file like this in your team's repository or on a share:

```jsonc
// sap-systems.jsonc - no secrets in here
{
  "defaultSystem": "dev",
  "systems": {
    "dev": { "url": "https://dev.example.com:44300", "client": "100", "keychain": true },
    "qas": { "url": "https://qas.example.com:44300", "client": "200", "keychain": true }
  }
}
```

Then a new team member runs one command:

```bash
npx -y @janfr/mcp-abap-adt setup --from ./sap-systems.jsonc
```

It folds the list into the user-level rc file (local settings win; the previous file is kept as `.bak`), asks once for username and password, and stores a keychain entry per system — after which both this server and the SAP Fiori tools extension work. `--skip-credentials` writes only the configuration; `--username <user>` skips the username question.

Details worth knowing when authoring the shared file:

- Only `.json`/`.jsonc` files are accepted and `extends` is refused: a shared file is edited by whoever can push to the team repository, so it must be data, never code.
- System names have to survive the rc file format: letters, digits, `_` or `-`, not digits only, no spaces or dots. `setup` rejects anything else before writing.
- A system that names no credential source gets `"keychain": true` automatically — a shared list exists for per-user credentials — and `setup` says which systems it enabled that way.
- Re-running `setup` after the team list changed is safe: local settings win the merge, and removals do not propagate (deleting a system from the team file does not delete it from anyone's machine).

Who may edit the shared file is a security decision, not housekeeping: the URLs in it are where colleagues' SAP passwords get sent. Keep write access to the file reviewed and small.

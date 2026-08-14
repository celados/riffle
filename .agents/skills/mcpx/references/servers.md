# Project MCP servers

Read this when a listed server is missing from `mcpx`, an unknown-server
error appears, or a call returns `reauth-required` /
`Credentials for <server> must be refreshed`.

Project-approved servers live in the user's global mcpx registry, not in this
repository. Reconstruct a missing server with `mcpx @add` using the recipe
below.

## Diagnose

```bash
mcpx
```

If that command is missing, read [install.md](install.md) first. Then compare
the listing to the project-approved servers named in `SKILL.md`.

## Register missing servers

Run only the `@add` command for a server that is absent.

### paper

```bash
mcpx @add '{"name":"paper","url":"http://127.0.0.1:29979/mcp"}'
```

## Authenticate

An ordinary `mcpx <server>.<tool>` call never starts login. If credentials
are missing or expired:

```bash
mcpx @refresh
```

`@refresh` may open a browser or prompt for an OAuth client. If the current
session is not a TTY, ask the user to run it in their terminal.

Once `mcpx` lists the server and a focused `@schema` call succeeds, return
to the skill.

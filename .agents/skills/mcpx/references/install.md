# Install mcpx

Read this when `mcpx` is missing: `command not found`, not on `PATH`, or
`mcpx --version` fails.

## Prerequisites

The released `mcpx` binary is a Bun executable. If `bun` is missing:

```bash
curl -fsSL https://bun.sh/install | bash
```

## Install

Install the latest mcpx release:

```bash
curl -fsSL https://raw.githubusercontent.com/celados/mcpx/main/install.sh | bash
```

The installer writes `~/.local/bin/mcpx`. If that directory is not on `PATH`,
add it for the current session and retry:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

## Verify

```bash
command -v mcpx
mcpx --version
```

Once `mcpx` runs, return to the skill. If a listed server is still missing,
read [servers.md](servers.md).

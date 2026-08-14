---
name: "mcpx"
servers: ["paper"]
description: "Use project-approved MCP tools through mcpx. Trigger when the user asks to inspect or operate services backed by these MCP servers: paper."
---

# MCPX

Use this skill when the task needs one of these project-approved MCP servers:

- paper

## Discover

Inspect the available tool surface before calling tools:

```bash
mcpx @schema '.paper'
```

Use schema selectors to narrow large MCP surfaces before choosing a tool:

- `.server` shows one server, for example `mcpx @schema .posthog`
- `.server."tool-name"` shows one kebab-case tool, for example `mcpx @schema '.posthog."projects-get"'`
- `.{a,b}` selects multiple keys at the current level
- `.server.{tool-a,tool-b,tool-c}` shows a short list of candidate tools

Normal workflow: inspect the project-approved servers first, identify likely
tool names, then follow the schema status line. If the schema says it was fully
output, call the chosen tool directly. If it says only a compact outline was
shown, run a narrower selector such as
`mcpx @schema '.posthog.{"projects-get","alerts-list","alert-create"}'`.

## Call

Call MCP tools through dotted command paths and pass one object input token.

```bash
mcpx <server>.<tool> '{ }'
```

For larger payloads, prefer file or heredoc input:

```bash
mcpx <server>.<tool> @payload.json

mcpx <server>.<tool> - <<'JSON'
{
  "example": true
}
JSON
```

## Notifications

Most tool calls emit no notifications and this section never applies. When an
MCP server pushes events during a call (progress, schema changes, custom
events), mcpx merges them into default structured output under `$notifications`:

```yaml
count: 1
$notifications:
  - method: notifications/progress
    params:
      progressToken: "..."
      progress: 3
      total: 4
      message: step 3
```

For non-JSON text, binary, or mixed content, mcpx falls back to a trailing
sentinel line:

```
<tool result lines>
$notification: [{"method":"notifications/progress","params":{...}}]
```

Each entry has `method` plus method-specific `params`. Special cases:

- `notifications/progress` may carry `aggregatedCount` on the last entry per progress token, meaning intermediate progress was collapsed (first and last preserved verbatim).
- `notifications/tools/list_changed` is handled by mcpx automatically; no agent action required.
- `$oversize` appears in raw context when the buffer cap was reached; default output renders it as `notifications oversize, saved to <path>`.

In raw context with a structured result and non-empty notifications, the
sentinel line is replaced by a JSON envelope:

```json
{ "result": <tool-result>, "notifications": [ ... ] }
```

Ignore notifications unless the task specifically depends on progress or
server events. Parse only when `$notifications`, the sentinel line, or the raw
envelope is present.

Do not hand-edit MCP configuration in this project. Servers are registered in the user's global mcpx registry.

## Troubleshooting

Stay on Discover/Call unless one of these symptoms appears:

- `mcpx` is missing (`command not found`, not on `PATH`, or `mcpx --version` fails) → [references/install.md](references/install.md)
- A listed server is missing from `mcpx`, or a call returns `reauth-required` / `Credentials for … must be refreshed` → [references/servers.md](references/servers.md)

# mcp-control is invisible from every discovery funnel

**Status:** Open
**Opened:** 2026-08-08 · **Severity:** P1 · **Area:** llms.txt / CLI help / package READMEs / templates / capability index / guide MCP

From the 2026-08-08 agentic surface audit (LLP 0202 theme 3). This is the
exact gap LLP 0184's summary opened with — "an agent commonly sees only the
read-only `snapback mcp` guide server" — still true at every entry point:

- `/llms.txt` (`src/server.rs:8001`, `LLMS_TXT`) lists five doc URLs and no
  MCP server at all.
- The native CLI's `after_help` (`src/cli.rs:734`) and the `snapback guide`
  channel output (`src/cli.rs:2136`) advertise `snapback mcp` only — never
  `mcp-control`, never `snapback agent setup`.
- `packages/snapback-cli/README.md:70` and
  `packages/snapback-app-cli/README.md:66` say "Run `snapback mcp`"; the
  root `README.md` has zero MCP mentions.
- All five scaffolded templates say the same
  (`templates/{react,expo-chat,todo-contract}/AGENTS.md:9`,
  `templates/{crud-dashboard,media-feed}/AGENTS.md:7`) — so every scaffolded
  project teaches its resident agent only the read-only server.
- `guide/capabilities.md` — the declared "start every task here" index — has
  no row or alias for the control MCP: `:113` is the read-only server, and
  `:107` (`operating.agent-controls`) has no `mcp-control`/`agent setup`
  alias words.
- The guide MCP's own `instructions` (`src/guide_mcp.rs:321`) steer agents to
  read the 229 KB manifest first, and its largest resource
  (`snapback-guide://flat`) has grown to ~1.83 MB — 2.5× since
  `issues/20260806-guide-flat-projection-oversize.md` measured it — instead
  of starting at the 50 KB capability index.
- `snapback agent setup` covers four harnesses
  (`packages/snapback-cli/agent-setup.mjs:72-82`); no VS Code
  (`.vscode/mcp.json`) target.

## Fix (small diffs, high leverage)

1. One two-line "Operate it" block — naming both servers and
   `snapback agent setup --print <client> --server mcp-control` — added to
   `LLMS_TXT`, both CLI discovery strings, both READMEs, and the five
   template `AGENTS.md` files.
2. Add `mcp-control, control mcp, agent setup, control tools` alias words to
   the `operating.agent-controls` capability row (or a dedicated
   `operating.control-mcp` row).
3. Point the guide MCP `instructions` at
   `snapback-guide://page/meta.capabilities` first, identity handshake
   second.
4. Add a `vscode` target to `agent setup` (same JSON writer, different
   path/key).

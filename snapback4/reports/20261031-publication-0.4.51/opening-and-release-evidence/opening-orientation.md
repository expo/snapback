# PUB051 orientation context

Scope: react.tsx asset/upload observations, local-status.ts and progressive local opening.

Governing constraints: LLP 3000.002.000 §4 (current) separates app.ready from local execution/acquisition; §6 preserves read publication; LLP 3000.008.002.000 §6 owns each asset handle by client, signout bit and id, with no replay of successful one-view reads and bounded transport recovery; LLP 3000.013 §6 owns facade lifetimes. LLP 0232 permits affected semantic-delta landing, not publication qualification reuse.

Paved surface: guide assets/client, app.ready/localStatus API comments and CHANGELOG. A temporary opening refusal needs an observation wakeup; an unavailable status is terminal and must surface its typed cause. Existing link and lifecycle ownership remain. No unresolved @ref. Doc update: startup §4 and 0.4.51 guide changes. Hand-off: scoped code/RFC review (Muse and fresh Codex), then affected checks.

# Review: LLP 0041 — Packaged developer loop

**Reviewed:** `llp/0041-packaged-dev-loop.rfc.md` (working-tree revision, 2026-07-07 draft)
**Family:** Claude (Anthropic)
**Provider/runtime:** Anthropic API via Claude Code — model Fable 5
**Date:** 2026-07-07
**Redacted:** No — reviewed locally; nothing sent beyond the model serving this
session.
**Method:** Single-session independent read, verified against LLP 0021, LLP
0030, LLP 0010, and the repo (`src/cli.rs`, `packages/`, demo package.json
scripts, `exact.pin.json` flows, `schemas/host-ready.schema.json`). Same-family
sub-agent passes assisted verification; this artifact is **one** family's
review.

> **Independence (LLP 0005).** Draft authored by Charlie Cheever / Codex
> (GPT-family); genuine cross-family review. LLP 0038 (the parent critique) is
> Claude-authored; findings below were verified against the repo directly.

## Overall assessment

The motivation is exactly right — the paved road ends at the monorepo boundary
— and the CLI surface and demo-dependency policy are the correct instruments.
But the draft has one large hole and several reality mismatches. The hole: it
never says how an external user obtains a runnable server. The `snapback`
binary embeds Hermes via vendored Ibex; on macOS it needs `hermesvm.framework`
at an `LC_RPATH`-relative path, and today only `scripts/bootstrap-ibex-runtime`
produces that. "npm or Cargo?" is not the open question — *native runtime
distribution* is, and it deserves a Design section. The mismatches: the package
list names things that already exist as if new (`@snapback/codegen`,
`@snapback/contract`), omits one that exists (`@snapback/admin-client`),
proposes one that is wrong-shaped (`@snapback/runtime-links` — runtime links
are generated per-app modules; the shared helper is already the
`@snapback/contract` adapter), and treats the `@snapback/*` namespace as fresh
when LLP 0021/0032 P6 already decided it. `snapback host-ops ... --json`
doesn't match the real CLI, whose host-ops verbs are already top-level
subcommands emitting `hostOpsResult` envelopes.

## Strengths

- The demo-dependency policy attacks the right emblem (cursors-web's build
  literally runs Vite from `../../exact`'s node_modules — worse than the
  draft states).
- "Generated but not loaded" vs "generation failed" is precisely the right
  watch-mode distinction, and offline codegen resilience is well specified.
- Templates-with-acceptance-scripts extends the corpus's machine-checkable
  discipline to the external loop.

## Concerns

1. **[HIGH] Native runtime distribution is unaddressed** (see above). The
   acceptance criterion "a clean directory outside the monorepo can run
   `snapback new` + `snapback dev`" is unbuildable as written without it.
   The existing `SNAPBACK_IBEX_HERMES_DOWNLOAD_FAILED` /
   `SNAPBACK_IBEX_HOST_UNSUPPORTED` codes suggest the intended shape (fetch
   prepared artifacts with coded failure paths); the RFC should say so.
2. **[MEDIUM] Package list vs reality** (see above) — the real new work is
   promoting `demos/_kit/client.mjs` to `@snapback/client` and packaging the
   CLI/binary; the RFC should name that work rather than re-proposing what
   exists.
3. **[MEDIUM] Ownership boundary with LLP 0030 unreconciled.** `snapback dev`
   overlaps the `@snapback/vite` plugin's attach/managed/auto lifecycle.
   0030's rule is that no consumer grows a private lifecycle dialect — the RFC
   must say who owns watch/codegen orchestration and how the plugin composes
   with the CLI (both projecting host-ops, plugin attaching via ready-file).
4. **[MEDIUM] The readiness handshake that already shipped is unused.**
   `snapback start --ready-file` writes a `HostReadyDescriptor`; `snapback
   dev`'s attach path and acceptance should consume it (no log parsing), with
   a `SNAPBACK_DEV_SERVER_TARGET_MISMATCH`-style refusal on mismatch.
5. **[LOW] Demo policy understates prior art:** `exact.pin.json` exists in all
   three Contract surfaces and detects drift; the actual gap (diary-evidenced)
   is that pins don't *hold* — the fix is consuming a tarball/vendored
   snapshot instead of the sibling checkout at all.
6. **[LOW] `todo-react` implies a React hooks package that does not exist** —
   name it as scoped work or lead with the Contract/headless template.
7. **[LOW] `snapback doctor` should wrap the existing `scripts/ibex-doctor`**
   rather than invent parallel diagnostics; the schema-validation open
   question is mostly answered by LLP 0037 (schemas are generated from Rust
   types; only shipping/validating them externally is open).

## Recommended next step

Revise and stay `Draft`. The revision is substantive (new Design section,
corrected package/CLI surface, 0030 boundary) but does not change the thesis.

## Revisions applied (2026-07-07, at the author's request)

Applied to the draft: "Runtime distribution" Design section replacing the
npm-vs-Cargo open question (concern 1); package list corrected to
exists/new-work framing with the 0021 P6 namespace decision cited (concern 2);
0030 boundary paragraph (concern 3); ready-file attach + acceptance (concern
4); demo policy reworded around pin-holds-vs-detects (concern 5); React hooks
package named as scoped work (concern 6); doctor-wraps-ibex-doctor and
narrowed schema OQ (concern 7); LLP 0042 added to Related. Status left
untouched.

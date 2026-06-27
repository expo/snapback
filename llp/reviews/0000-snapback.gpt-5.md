# Review: LLP 0000 - Snapback

**Reviewed:** `llp/0000-snapback.explainer.md` (working-tree revision)
**Family:** GPT-5 (OpenAI)
**Provider/runtime:** OpenAI API via Codex
**Date:** 2026-06-25
**Redacted:** No - reviewed in-repo LLPs, existing review artifacts, and selected
local Exact repository docs; no external review was requested or recorded.
**Method:** Single-session read-and-critique of the full Snapback LLP corpus,
Claude review artifacts, and current local Exact README/agent instructions;
targeted revisions applied where they clarified existing direction.

## Overall assessment

The root explainer is a strong product anchor: agent-first backend, local-first
partial sync, Contract/Exact priority, open hosting, and scale-to-zero are all
clear. The review pass improved three places: it replaced stale "Valet failures
not recovered" wording, added a benchmark gate for scale claims, and narrowed the
Contract/Exact terminology gap using current Exact repo facts without making
Snapback the authority for Exact.

## Strengths

- Clear north star: scale to zero, then scale up, with Rails-like coherence.
- Good reference-app breadth; it covers sync, auth, assets, cron, fan-out, and
  correctness rather than only CRUD.
- Honest non-goals keep high-frequency games, analytics, and CDN workloads from
  silently steering v1.

## Concerns

- **C1 - Scale target is still unproven. [High]** The Partiful-scale target is
  useful, but it must not become an implicit claim before benchmark envelopes
  exist. The new benchmark gate helps; it now needs tests in LLP 0010.
- **C2 - Contract/Exact remains externally gated. [High]** The current Exact
  repo gives enough context for Snapback-side design, but the stable canonical
  citation is still owed.
- **C3 - Cloudflare is named as second step but lacks an LLP. [Medium]** Because
  Cloudflare may force architecture changes, it should get a strategy RFC before
  local assumptions harden too much.

## Suggestions

- Create the Cloudflare strategy LLP before implementing portability-sensitive
  runtime or storage seams.
- Treat every reference app as either a demo-shape proof or a benchmark proof;
  do not blur the two.

## Open questions

- Where will the stable Contract/Exact definition live?
- What workload numbers define "Partiful-like" for the first benchmark?

## Recommended next step

Status can remain `Active`. Next: ratify or supply the Contract/Exact definition,
then create the Cloudflare/deployment strategy and benchmark profiles that make
the scale target testable.

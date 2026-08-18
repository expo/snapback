# Review: LLP 0000 Snapback, Round 1

**Reviewed:** 2026-06-25
**Reviewer:** Codex
**Target:** `llp/0000-snapback.explainer.md`

## Overall Assessment

This is a strong root LLP document. It captures the major product intent from
the founder brief: complete backend, scale-to-zero and scale-up, SQLite to
Postgres, Ibex/V8, auth, assets, cron, notifications, local-first sync,
realtime, run-anywhere deployment, Contract/Exact priority, MIT licensing,
agent-first development, and Valet as predecessor.

As a root explainer, it is good enough to orient future work. The main weakness
is that it is carrying too many provisional architectural commitments without
enough explicit ratification, testable target definitions, or immediate
follow-on documents. If implementation starts from this alone, agents may treat
broad aspirations as settled design.

## Strengths

- The document is clear about Snapback's distinctive shape: coherent backend
  under one roof, not a bag of disconnected services.
- The v1/v2 split is pragmatic. AI gateway and data gateway are correctly held
  out of the launch path.
- The local-first and realtime requirements are present and concrete enough to
  prevent them from becoming afterthoughts.
- The storage transition requirement is correctly framed as a hard design
  constraint: SQLite to Postgres must not be a rewrite.
- The document names the scary parts instead of hiding them: high-frequency
  fan-out, Valet's unresolved empirical problems, Cloudflare's unusual
  constraints, and the need for follow-on LLPs.

## Concerns

1. **Status may be too strong unless Charlie is explicitly ratifying this exact
   text.** The document is marked `Active`, while it says several architectural
   choices are provisional and should be settled later. If this text is
   directly founder-ratified, `Active` is defensible. If it is an agent-written
   synthesis awaiting review, it should stay `Draft` and include provenance or
   a short "Source" section.

2. **Agent-first scope is slightly narrowed from the brief.** The brief says
   basically all code for Snapback will be written by agents and that human DX
   does not really matter. The LLP says "Snapback app code" will be written by
   agents. That could be read as optimizing only generated user apps, not the
   Snapback framework/runtime itself. If agent DX governs both Snapback's own
   implementation and apps built with it, say that explicitly.

3. **The deployment target list is broader than the architecture currently
   supports on paper.** "Run anywhere" plus Cloudflare, AWS, Google Cloud,
   Azure, DigitalOcean, Hetzner, local hardware, SQLite, Postgres, filesystem,
   object storage, Ibex, and V8 is a huge matrix. The document correctly says
   Cloudflare needs dedicated effort, but the next LLP should pin down what
   "works well" means per platform, especially where filesystem, SQLite, and
   long-running processes do not map cleanly.

4. **The scale target needs a workload envelope.** "Partiful at a few hundred
   thousand monthly active users on SQLite + Ibex" is a useful north star, but
   it needs bounds: concurrent users, writes/sec, read fan-out, realtime
   subscriptions, asset upload volume, cron load, notification throughput, and
   acceptable latency. Without that, agents can satisfy the words while missing
   the real target.

5. **Asset storage is too absolute about not using the database.** The founder
   brief said assets should typically not live in SQLite/Postgres. The LLP says
   assets are not inside SQLite/Postgres. Better distinction: object bytes go to
   filesystem or object storage; metadata, ownership, indexing, processing
   state, and maybe tiny edge-case blobs can live in the database.

6. **The Valet retrospective is an urgent dependency, not just a nice follow-on.**
   The document says Valet's empirical problems should be recovered later. Since
   Snapback is intentionally carrying forward the rough Rust + SQLite +
   JavaScript execution shape, those failures should be captured before major
   architecture hardens.

7. **Auth is correctly prioritized but underspecified relative to its importance.**
   The document says auth/login is first-class and WorkOS/Clerk-like, but does
   not yet name the design surface: users, organizations, sessions, passkeys,
   OAuth/SAML/OIDC, invites, multi-tenancy, auditability, data export, provider
   interop, and local-first implications. A dedicated auth LLP should come
   early.

## Suggestions

- Add a short "Source and Ratification" section to LLP 0000. If Charlie has
  ratified this document, say so plainly with date. If not, mark it `Draft`.
- Tighten the agent-first principle to cover Snapback's implementation,
  Snapback-authored generated code, and app code written by agents.
- Promote these follow-on LLPs to immediate next documents:
  storage portability contract; local-first sync and realtime model; runtime
  and deployment matrix; agent DX and validation loops; auth; Valet
  retrospective.
- Add a "Non-goals / likely out of scope" section. High-frequency positional
  realtime games are already hinted at; make the boundary clearer.
- Keep LLP 0000 as a stable north-star document and avoid turning it into the
  detailed spec for every subsystem. Each subsystem should get its own LLP
  before implementation becomes concrete.

## Open Questions

- Is `Active` intended to mean "Charlie reviewed and ratified this text," or
  only "this is the current best synthesis"?
- Does agent-first apply to the Snapback framework codebase itself, generated
  user backend code, client integration code, or all of the above?
- What exact Valet empirical failures should constrain Snapback v1?
- What is the minimum viable local-first sync model for launch?
- Which deployment targets are launch-blocking, and which can follow after the
  core architecture works locally and on one hosted environment?
- What benchmark should prove the SQLite + Ibex stack is viable?

## Status Recommendation

If Charlie has ratified this document, keep it `Active` after addressing the
scope/provenance wording. Otherwise, move it back to `Draft` until those
clarifications are made.

The LLP process also recommends a GPT review unless this Codex review is the
GPT review wanted for this round.

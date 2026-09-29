# Lane RL round 3 context

Scope: the local `/changes` handler, incarnation reset, quiet presence
publication, the schedule model and client documentation. Used `llp-orient`;
no delegation. Read rounds 0–2 prompts and reports, the round 3 prompt, the
complete Astra round 2 review and Grok's progress notes, followed by its
completed READY review. Both low-priority Grok findings are included: members-only
intersection coverage and conservative handling of an omitted online table list.

Governing context:

- LLP 3000 §4: independent Snapback 4 workspace and checks; in current/.
- LLP 2000.000 §7.2: published partition and program authority.
- LLP 3000.007 §18.2: retire the old incarnation before reads and replay.
- LLP 3000.016 §2.2: local evaluation and whole/server/composed routing.
- LLP 3000.018 §3.2: quiet presence and ordered remembered answers.
- LLP 3000.019 §3.3: observation ownership, expiry and resets; in current/.
- LLP 3000.023 §§3.4, 3.6, 10: hard boundaries, facade deadlines and bounded
  change evidence; in current/.
- LLP 3000.029 §0: Shelved; no replacement ordering system.

The foundation overlay is Snapback 1's kernel; the explicit Snapback 4 fence
routes here to LLP 3000. Read the current client guide, Snapback 4 AGENTS,
NOT-DOING, root RULES and journal tail. The author explicitly commissions this
round and its detecting tests; no new review or approval flow applies.

Constraints: generation changes are hard boundaries independent of sequence
and touched tables. Reuse `observeIncarnation` to reset every observation,
clear remembered answers, fence in-flight work and set `partitionCurrent`
false. Adoption restores eligibility through the existing sync path. Plain
revalidation retains, other change evidence remains bounded, and immediate
valid replica replacements remain direct. Quiet presence must respect the
pending cut. No new public type, ordering domain, runtime, budget or gate.

The reference model derives program authority from the injected fixture's
notification, independently of SDK output. Real dev adoption supplies the
unchanged-sequence/empty-tables envelopes for both focused tests and replay.
Remaining coverage limits: finite schedules; no new native-plugin or cutless
variants, and no native simulator claim.

Documentation updates: LLP 3000.023 §10, the client guide, README and operations
manual, plus this report and one journal append. No new LLP. Hand-off: none.

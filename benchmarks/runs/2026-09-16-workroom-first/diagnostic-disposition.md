# Workroom diagnostic pilot — final-source disposition

Date: 2026-09-17 UTC. **Not qualified for a cold/scored cell or calibration.**
The original builder attempt and adopted replay remain failed-capped. A
separately authorized warm continuation completed, and the original builder
then supplied a closing handoff without changing application code. These are
useful diagnostic results, not a retroactive pass of the original attempt.

## What completed

The warm continuation ran 03:07:05.472–03:14:45.380 UTC on Durand with
Node 24.13.1 and published `snapback4@0.2.26`. It applied the remaining
10,933 full-stream records and skipped 587,291 previously receipted records.
The durable journal has all 598,224 records. The application acceptance
program exited 0 and reported 27 assertions pass, two performance ceilings
not run, zero scale/report failures. Eight observed process identities ended
with no custody uncertainties or survivors. This is a statement about that
program's execution, not independent endorsement of its assertion coverage.

Before continuation, the supervisor established quiescence and made a
SQLite online logical backup, verified by immutable read-only `quick_check`.
An earlier failed verification attempt remains recorded. The backup includes
committed WAL state; it is not a byte-for-byte three-file SQLite image.

At 03:27:51.404–03:34:48.600 UTC the original native builder thread
`01a0abb9-5fa7-7a70-bbb3-22c9765ebbab` produced its final handoff. The only
application-tree addition was `FINAL.md`; no existing file changed or was
deleted. All 31 packet files remained unchanged. No independent audit hints
were given to that builder. The builder's essay is retained privately and is
not an independent outcome grade.

## Source binding and retained evidence

The supervisor extracted the final archive into a separate private directory,
verified these hashes, and rebound the earlier independent source audit to
the unchanged final code. Neither audit ran the application or an exploit.

| Artifact | SHA-256 |
| --- | --- |
| Final source archive | `8e6491b3eea7bdd2d64ffb92d9ab6895e7c2d3f254a52565385bd2ea8d311f07` |
| Final source manifest | `be8bc66f8a60d6b172d68c3ddfa1f570cadde2dfcb74975ab5fa369369481450` |
| `adapter.mjs` | `a07c2bde36d7aceff81481f98a6d26c6c9d66b4f7a1197d1534b247024874318` |
| `snapback/schema.q` | `2c9db8b09777363a24d9c95085bacae77608bff50fa1554dee646164b09616c9` |
| `snapback/server.ts` | `619bc20cb22e6575bcc3489b3e8046460519666168c5fb85e1e9b38194ffbdb7` |
| Builder `FINAL.md` | `ddc1f9fc6f8edb8f24c62b8c1c653f53bb511d342594434fc6632f1f3ac1da8b` |
| Warm terminal receipt | `0fba975b4b5a4862df3536e5e76735b84be53565797b7cebfe2dae20f2111917` |
| Full journal | `2b7ea31427df66995ac87a0ae7c06fb7aa39f0bc564ebbd83d20c99613f3be55` |
| Acceptance output | `3f25c1189485ab10c149f01444d64916373a0aa0aa83f98d53c7ccb8028cec22` |
| Source-snapshot receipt | `409e2c41a55685455c6c323e354883faa3e90b3a1df595bfd2e9b8fcb20f2584` |
| Timestamp correction | `3074dbc90ef2b2a329a9be433937d65234d448e06c881ed939297167ef13cca2` |

The unchanged snapshot receipt incorrectly labelled a Pacific store mtime as
UTC. Its separate correction records epoch `1789614869`, namely
**2026-09-17T03:14:29Z**, not `2026-09-16T20:14:29Z`. Store bytes and digest
were unchanged. Original and correction are both retained; the original was
not silently edited.

Private originals remain under Durand's
`/Users/ccheever/workroom-runs/20260916-pilot/private/`, and application
state/evidence in its recorded run directory. Raw provider records, account
credentials, sessions and model reasoning are not published here.

## Independent qualification disposition

The [prewritten checklist](protocol/qualification-checklist.md) remains the
authority. The builder's handoff overstates W3/W5 coverage and search result
validation in places; the following source-bound limits take precedence.

- `scripts/acceptance.mjs:311–314` marks every W1–W5 assertion passed after
  starter replay. This blanket assignment does not observe every public
  requirement. Neither a zero exit nor 27 pass labels closes the missing cases.
- `schema.q:242–247` accepts an arbitrary profile-email argument from an
  authenticated principal. Invitations later resolve this profile to a
  principal. Normal login alone therefore does not establish ownership of
  that profile email. The inspected published docs/types offer no complete
  trusted-email profile recipe; this is a bounded discoverability finding,
  not proof that every application composition is impossible.
- Invitation rows permit reads and `invitation(id)` returns the full row
  without recipient/tenant authorization (`schema.q:93,517–518`). This is
  source evidence of a policy gap, not a runtime exploit demonstration.
- Invitation/reminder windows use fixed short literals instead of the
  declared configurable production and fixture windows. A pending invitation
  also lacks the already-member no-op branch if its recipient joined by
  another path before acceptance (`schema.q:489–504`).
- Membership and audit insertion are atomic in the source mutation. The
  acceptance assertion reads them separately, so it does not supply the
  checklist's same-state witness. Wrong-recipient/expired/revoked cases lack
  complete before/after membership-and-audit comparisons; reuse lacks a
  complete email/reservation comparison.
- The deliberate mutation-response loss targets `project.create`, not an
  invitation. Its retry remains in-process. Replaying an already completed
  receipt journal is not the invitation lost-response/restart witness.
- W5's raw-byte HMAC and bad-signature intermediate five-field comparisons
  are stronger source coverage. Duplicate/old/backlog assertions do not
  establish all final revisions, complete effective-audit changes, every
  delivery's completion or actual occurrence of both injected fault types.
  Their private runtime records still require independent reconciliation.
- Provider-enqueue fetch/body-read uncertainty is not classified
  `TRANSPORT_UNKNOWN`; no enqueue-lost-response/restart witness establishes
  preservation of the original batch/delivery IDs. Distinct-address seat
  reservation, release, changed-plan acceptance and ordinary past-due
  read/write surfaces also need the checklist's explicit probes.
- W4's UI advertises 10 MiB while inline base64 is stored in `text <=1000000`.
  The builder correctly admits that mismatch; passing the small supplied
  attachments does not qualify the advertised size envelope.
- The large search timing check requires nonempty string IDs, not known-hit
  identity or tenant/project authorization. Its 50 returned rows do not by
  themselves substantiate the handoff's stronger “tenant-valid” description.

An earlier provisional finding was narrowed, not silently erased: the
fixture-admin environment reaches the restarted CLI/backend process, but
handler exposure is **not established**. Published `dev` documentation says
the TypeScript child's environment is explicitly constructed and undeclared
variables are excluded. Do not report a proven handler credential leak.

Thus W3/W5 are **not independently qualified**, W6/W7 performance ceilings
are **not run**, and W8 is **not yet attempted** at this source snapshot.
No numeric grade or service-selection conclusion follows.

## Descriptive measurements, not frozen ceilings

The full report validated all 2,000 expected member rows with zero failures:
59,000 open tasks, 29,000 overdue tasks and 1,672,500 attachment bytes.
Its five warm reads had median 269.061458 ms, range 267.176417–273.479125 ms;
the separately labelled restart read was 276.929833 ms. Search's five warm
reads had median 0.444459 ms, range 0.395333–0.471875 ms; the restart read
was 1.763375 ms, with the result-validation limitation above.

These samples are over an already populated store. Five warm samples and one
restart sample do not establish a calibrated tail distribution. Earlier
indexing and cleanup contention also preclude an idle-machine ceiling claim.
The final webhook 0.145 ms and invitation 0.005 ms entries measure receipt
skips, not service latency; the builder correctly rejects those numbers.
The 442.3-second replay field mixes 587,291 skips with 10,933 new writes and
is not full replay throughput. Original full replay elapsed time is unknown
across the capped boundaries. Missing timings remain unavailable.

## Next boundary

A fresh same-family W8 diagnostic may operate on a consistent isolated copy
of this final app and seeded store. It must preserve the original, use the
same published pin and no application SQL, and receive only the public W8
brief plus neutral operating instructions—not this audit. Its 90-minute
operational cap is not a frozen benchmark budget. Source-bound W8 evidence,
remaining qualification probes/repairs, idle-host calibration and a common
packet freeze precede the separate cold three-family cells and matched
controls. Services are implemented concurrently; retention/removal waits for
the completed Workroom evidence, as Charlie directed.

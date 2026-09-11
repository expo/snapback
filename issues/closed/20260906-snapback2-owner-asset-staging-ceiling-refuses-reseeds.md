# snapback2: the owner's asset staging ceiling (40 objects / 512 MiB) refuses reseeds and sample media

**Filed:** 2026-09-06 by Claude Fable 5.1 from the Clique full run (benchmarks/runs/2026-09-05-clique-full-3x3), builder evidence as cited; raw lanes at /Users/ccheever/clique-full-20260905/lanes/.
**Status:** Closed — fixed slot leak requalified against the committed sample-50 media sequence (2026-09-11) · **Severity:** resolved
**Priority:** P1

## Symptom
Reseeding a project with fixture media, and the sample action log's media, hit `E_ASSET_TOO_LARGE` at the owner's staging ceiling of 40 objects or 512 MiB.

## Evidence
- `/Users/ccheever/clique-full-20260905/lanes/grok-snapback2/final-report.md` correction loop 12 and gap 6

## Current disposition (2026-09-06)
The asset-pending lane independently reproduces successful releases consuming the
20/40 pending-object quotas. Root directs separating those slots from released
ready originals while preserving the existing 256/512 MiB byte-admission charges;
no numerical limit or project setting changes. The original proposed configurable
ceiling is not the accepted fix.

Implementation/proof: `/Users/ccheever/clique-improvement/revisions/asset-pending-r1/implementation-report.md`
and its source/test/witness receipts. The isolated public Quarry witness is not
an original benchmark rerun. This ticket remains open for attribution and full
Clique/reseed verification; the original failure is not retroactively passing.
Separate inherited physical custody/GC work is tracked in
`20260906-snapback2-asset-custody-gc-follow-up.md`.

## Reconciliation — 2026-09-11

Commit `67a082084` and the fresh seven-retry regression recorded in the abandoned-upload
ticket verify that unattached retry objects no longer consume pending object/byte charges.
They do not widen the retained 40-object / 512 MiB owner admission policy and do not
re-run the original Clique fixture pack. The evidence narrows the likely cause but does
not establish that the named reseed/sample-media workload fits.

Next acceptance: rerun the original reseed and sample-media workload in a fresh owned
temporary store, record peak objects and bytes by lifecycle state, and distinguish a
real live-footprint ceiling from the fixed retry leak. Widening/configuring the limit
requires separate authority; this triage grants none.

## Fresh deterministic lifecycle control — 2026-09-11

The current public-owner controls pass 3/3 in 11.043 seconds without changing
the 20/40-object or 256/512 MiB policy:

- `asset-pending.test.ts` committed 43 equal-byte claims with 43 distinct asset
  identities, released 40, reported `objects: 0` and 6,240 charged ready bytes,
  restarted, preserved every original byte digest, admitted a fresh principal's
  upload, and re-claimed one exact released record.
- Its pre-body byte probe was refused from the recorded 6,240-byte lifecycle
  state, proving that released originals still consume byte custody while no
  longer consuming pending-object slots.
- `asset-pending-caps.test.ts` re-proved 20 slots per creator and 40 per owner,
  including nondisclosure to a third principal. Twenty-one replacements ended
  with zero pending objects and 3,276 released ready bytes.

This is durable evidence for the repaired lifecycle, not the requested original
Clique rerun: the historical lane path named above is absent on the current
machine and the committed benchmark record contains reports, not its fixture
media or executable sample-50 app. Keep this ticket open. Remaining acceptance
is exactly one source-bound rerun of that retained external workload (or a
committed equivalent fixture with the same media/action sequence), recording
peak receiving, unreleased-ready, released-ready, failed/tombstoned object
counts and charged bytes. If that live footprint itself exceeds 40/512 MiB,
policy change still requires separate authority; if it does not, close this as
the already-fixed retry leak.

## Source-bound qualification — 2026-09-11

The external historical lane remains absent, but the repository now carries
the frozen `benchmarks/fixtures/social-messenger/sample-50.log` and its exact
media pack. A permanent fresh-owner test extracts all 16 affine media uses from
that 50-action log (four avatars, seven post images, two post videos, two
message images, and one message video), uploads the committed bytes under their
four authored actors, attaches them through image/video mutations, and releases
them through the corresponding actions.

Measured lifecycle maxima on the source-bound run:

- receiving control: 1 object / 133,134 charged bytes;
- unreleased ready: 16 objects / 171,493 charged bytes;
- attached: 0 pending objects / 0 unlocated charged bytes;
- released ready: 16 listed rows, 0 pending objects / 171,493 charged bytes;
- failed and tombstoned: 0 objects / 0 bytes.

The test additionally requires 16 distinct engine-minted identities and checks
every released row is ready, has a release clock, and is not reclaiming. The
workload is far below the unchanged 40-object / 512 MiB owner ceiling, so the
historical refusal is attributed to the repaired pending-slot leak; no policy
number or project setting changed.

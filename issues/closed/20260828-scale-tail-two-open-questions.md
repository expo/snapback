# Two questions from the sealed 0.1.29 scale tail

**Status:** Closed
**Opened:** 2026-08-28
**Systems:** Live queries, Auth, Assets, Sync, Codegen
**Related:** LLP 0317 §Scale tail (O47–O51), LLP 0317.000

The `sol-snapback-explicit` lane sealed on 2026-08-28 with 7 greens. Its scale
phase is classified in LLP 0317. The two items below are **not** backlog rows:
they are questions about deliberate design. (A third item drafted here — the
saturated ledger itself — did become a row, **O53**, once review established
that the paved recovery cannot apply to an application that has lost its
predecessor ACK cohort.)

## 1. Should a saturated durable mutation ledger block *reads*?

At both scale checkpoints, once the durable client-mutation ledger reached its
10,000-record global ceiling, `SNAPBACK_CLIENT_MUTATION_RETENTION_FULL` refused
**celebrity/small post acknowledgements plus Insights and Trending
mutation-backed reads**.

**Correction (review, 2026-08-28):** the documented recovery requires
re-entering the **predecessor authority cohort**
(`guide/sync/offline-and-retention.md:981,1037`), which an application that has
lost those ACK obligations cannot do. That gap is now **LLP 0317 O53**, not a
non-defect. What remains open here is the separate blast-radius question
below.

But the *blast radius* is worth deciding deliberately. Insights and Trending
are **reads**; they were mutation-backed only because the explicit JS mutation
contract rejects an empty write set (LLP 0317 O13, and the read-model
commission C5). A full write ledger stopping analytical reads is a coupling
that C5 would sever. Questions:

- Is refusing reads on a saturated write ledger intended, or incidental?
- Does C5's first-class read model remove this class entirely? If so, that
  raises C5's priority above where the program currently has it.

## 2. Should codegen refuse a view-once surface on public-immutable delivery?

The lane reported that view-once and delete-for-everyone did not revoke
already-delivered asset URLs. That is true and it is **documented**:
`guide/recipes/view-once-media.md` prescribes `grants: true`, an `owner-only`
read policy and `delivery: { kind: 'private-strict' }` *precisely so* close or
delete denies the next governed byte request, and it warns that revocation
"controls future governed requests, not bytes the client already copied."

The lane used public-immutable delivery, which cannot revoke by construction.
So this is an authoring error against clear guidance — but it is a
**security-shaped** one: the app shipped a view-once feature that does not view
once, and every UI-level fact suggested it worked.

Per the program's P2 ladder, the cheapest prevention that would have stopped it
is generate-time, not documentation: should codegen refuse (or at minimum warn
on) a view-once/revocation-shaped surface declared over a public-immutable
asset? The two declarations are visible together at generate time.

## Third item, ticketed separately

Candid gap 1 — the table-native conversation and receipt projections being
broader than membership-filtered private reads, so an opaque chat ID can expose
data — is the measured confidentiality cost of the O17 workaround and is
tracked with O17 rather than here.

## Resolution (2026-08-28)

Both questions are answered in
`llp/0317-clique-0129-correction-loop-disposition.research.md`
§"Scale-tail questions answered (2026-08-28)", with the r4 revision-history
entry. No implementation was done, as the ticket specified.

**1. A saturated ledger does not block reads — the premise does not hold.**
`SNAPBACK_CLIENT_MUTATION_RETENTION_FULL` is raised on the path that admits a
durable client-mutation id (`crates/snapback-kernel/src/storage.rs:24216`); its
own message says "before submitting another durable id". It never participates
in query evaluation. The lane's record separates the two: at the 50%
checkpoint, "query probes completed at p95 57.2-106.6ms" *while* the
acknowledgements, Insights and Trending were refused (`run-log.md:281`).

- *Intended or incidental?* Refusing a new durable id on a saturated
  exactly-once ledger is **intended** — that is what the retention promise
  means. The coupling to reads is **incidental** and is not the ledger's: it is
  created upstream, where the empty-write-set refusal (O13) forces an
  analytical read to be authored as a mutation. Insights and Trending were
  reads wearing a mutation.
- *Does C5 remove the class?* **Yes, by construction**, and that is now the
  strongest argument for its priority — a handler that may declare no writes is
  dispatched as a read, never takes a ledger record, and is outside saturation
  permanently, without tuning a limit. C5 is **raised to bundle 3** in
  `llp/0317.000` with a second acceptance witness (a read-model handler must
  not consume a durable client-mutation record). Scope kept honest: C5 does not
  fix O53, does not raise the ceiling, and does nothing for an app whose real
  writes saturate.

**2. Codegen should refuse declared revocation over non-revocable delivery, and
should not sniff application vocabulary.** The question conflates two shapes:

- **Refuse:** `grants: true` on an intent whose `delivery.kind` is
  `public-immutable`. A grant edge is authority over a *governed* byte request
  and public-immutable delivery has no governed read to gate, so the grant can
  never deny a byte. Both facts are in one declaration and visible together at
  generate time; nothing couples them today. Precedent exists one subsystem
  over (`SNAPBACK_MEDIA_COLLECTION_SHARING_GRANTS_UNDECLARED`). Recorded as
  **LLP 0317 O54** and ticketed as
  `issues/20260828-codegen-refuse-grants-on-public-immutable-delivery.md`,
  together with a second half: revoke/close against a `public-immutable` intent
  should be a typed refusal, not a silent no-op.
- **Do not refuse:** an application-level view-once feature that declares no
  revocation — which is what this lane actually shipped (public-immutable
  delivery plus an `expiresAt` flag and UI hiding; `run-log.md:167`,
  `final-report.md:113`). Codegen sees no revocation declaration; the only
  signal is authored vocabulary, and such a rule cannot be stated precisely,
  fires on legitimate designs, is not profile-neutral, and turns naming into a
  generate-time failure.

**The residue is stated rather than papered over.** After O54, an app that
never reaches for revocation at all is still unprevented — and that case is not
a knowledge gap: `run-log.md:131` records this lane confirming from the served
guide that public-immutable deletion cannot retract already-cached responses,
and shipping anyway. More prose is not the intervention.

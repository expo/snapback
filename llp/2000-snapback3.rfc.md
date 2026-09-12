# LLP 2000: Snapback 3 — the whole application as the unit of design

**Type:** RFC
**Status:** Accepted
**Role:** Root of the commissioned Snapback 3 experiment
**Systems:** Snapback 3 product architecture, authoring, client, authorization,
live data, offline behavior, performance, developer tools, deployment and operations
**Author:** Codex / GPT-6 Astra, at Charlie Cheever's request
**Date:** 2026-09-12
**Revised:** 2026-09-12 (first slice, focused Clique evidence, and qualified SDK acquisition)
**Related:** LLP 2000.000 (second opinion: keep the core, flip two substrates), LLP 3000 (Snapback 4, the sibling candidate that builds it), LLP 0000, LLP 0329, LLP 1000, LLP 1014, LLP 1018,
LLP 1018.008, LLP 1018.008.008, LLP 1018.008.009, LLP 1020, LLP 1023

## 1. Summary and author direction

Build Snapback 3 as a parallel experiment alongside Snapback 2. Design it
around the entire life of an excellent application: building it, using it,
changing it, deploying it, debugging it, and recovering it. Let that
experience determine the architecture.

The central standard is **the system stays understandable when you combine
features, lose connectivity, grow the data, and change the application**.
An elegant core contributes to this outcome. The complete product also
depends on the responsibilities imposed on builders, the behavior users
experience, and the work operators must do.

On 2026-09-12 Charlie asked how a from-scratch Snapback 3 could become an
ergonomic, elegant, performant, beautiful product in its entirety. After the
discussion, he requested this write-up as LLP 2000 and expressed interest in
implementing Snapback 3 in parallel with Snapback 2 to discover whether it
turns out well. That is the author direction behind this document. The
architecture preferences, reference applications, experimental sequence, and
evaluation criteria below are proposed by Codex; they are not measured results
or separately ratified technical decisions.

Charlie subsequently explicitly commissioned implementation, permitted reuse
from Snapback 2, and commissioned Fable's independent Snapback 4 attempt for
comparison. Acceptance here records authorization for this experiment; it
does not claim the proposed architecture has met its product goals. He also
requested side-by-side directories in the main checkout and Oxc/Rolldown or
TypeScript instead of esbuild absent a specific reason to choose otherwise.

The first implementation experiment should combine a composed live screen,
durable offline editing, cold acquisition, and a schema change with pending
work. It should reveal whether a different division of responsibility can
make ordinary application development simpler while meeting the same
authorization, durability, and product requirements. Snapback 2 continues
its own development throughout the experiment.

## 2. Motivation and evidence

The original [Snapback direction](./0000-snapback.explainer.md) remains
compelling: a comprehensive, coherent, open backend that costs very little
when idle and can serve a successful production application. Snapback 3
should carry forward that ambition, including MIT licensing and a credible
self-hosting path.

[Snapback 2](./1000-snapback2.explainer.md) has structural strengths worth
preserving: an analyzable data language, shared execution semantics, server
authority, durable offline work, and explicit attention to iteration speed.
The evidence motivates testing different boundaries; it does not establish
that all of these mechanisms need replacement.

| Recorded evidence | Design implication | Limit of the evidence |
| --- | --- | --- |
| [LLP 0329](./0329-agent-native-rebuild-diagnosis.research.md) diagnoses capabilities that depended on authoring form and complexity accumulating in the client | Capabilities and their requirements must be legible where an operation is authored; application syntax must not conceal a different security or offline contract | This is the Snapback 1 diagnosis, not a claim that the same defects remain in Snapback 2 |
| [Locality research](./1018.008.008-locality-of-application-changes.research.md) records an optional `editedAt` field increasing certified row width and forcing a search page from 20 to 19 | Evaluate ordinary changes against the whole application; study whether execution and evidence costs follow the dependencies actually affected | The refusal was a real bound for that schema, not proof of incorrect pricing or a universal page limit |
| [The residual assessment](./1018.008.009-residual-ergonomic-gaps.research.md) describes additional presentation declarations and roughly 28.5-second acquisition observations against a 2–3-second objective | Screen composition and acquisition performance must influence early architecture | Results have different source, host, and workload scopes; passing content checks and meeting latency objectives are separate claims |
| [Diary 0119](../diaries/0119-snapback2-chat-starter-media-and-editing.diary.md) records draft/media lifecycle defects and a short screen achieved partly by moving code | Measure total responsibilities and user behavior across the SDK and application | Historical defects include repairs; component line count alone measures neither complexity nor quality |
| [The control-plane retrospective](./1014-control-plane-lessons-from-snapback-1-and-the-field.research.md) describes extensive design preceding a complete deployment path | Put a real deployment and operating experience into an early slice | The retrospective predates later Snapback 2 implementation; it supplies a sequencing lesson |
| [The completed Clique diagnostic wave](../benchmarks/runs/2026-09-12-snapback2-clique-0029/README.md) records persistent client coordination, costly cold acquisition, storage amplification, and incomplete whole-app outcomes | Test these costs directly in S3; port applicable correctness repairs and challenge inherited substrates with measurements | The builders used 0.0.29; later 0.0.30/0.0.31 source repairs are not a new builder result. See §14 |

These records support a hypothesis: important remaining costs arise where
one layer must reconstruct another layer's facts or coordinate its lifecycle.
A reboot should test that hypothesis by changing ownership and observing
complete applications. Rewriting equivalent boundaries in fewer lines would
provide weaker evidence of a product improvement.

## 3. The product being designed

The product promise is that a small team or an agent can build a polished,
responsive web or mobile application, evolve it with real data, and operate
it without routinely learning Snapback's internal coordination mechanisms.

There are three experiences to design together:

| Audience | What should feel excellent |
| --- | --- |
| Builder, human or agent | Discovering, expressing, verifying, and changing behavior |
| Application user | Responsiveness, continuity, predictable interactions, and recovery |
| Operator | Deployment, visibility, diagnosis, cost, repair, and data ownership |

Four properties make this promise concrete:

- **Composition:** adding a count, pagination, media, or offline support has
  understandable consequences for an existing screen.
- **Locality:** an ordinary change affects the parts of the application whose
  meaning or resource requirements changed. Necessary wider effects are
  explained and preserve recoverable work.
- **Continuity:** pending work, useful authorized data, and user input survive
  the transitions their product contract promises. Account changes and
  revocation still enforce their boundaries.
- **Performance:** the application remains responsive during acquisition,
  persistence, reconnect, background work, and growth.

Whole-product scope is compatible with a small feature set. A selected
application should have a complete lifecycle; additional application domains,
hosting targets, and specialized features can wait for evidence of demand.

## 4. Reference applications as an executable design

Start with a social/messaging application using familiar Clique scenarios.
Use a field-work application as the second reference: offline forms, photos,
assignments, permissions, and background processing. Keep a third,
substantially different application out of the initial design exercise so a
later builder can test whether the abstractions generalize.

Before committing to the core, write representative application code in the
interface we wish to provide. Sketch the development tools and prototype the
interactions. Label mocked behavior explicitly. This prototype is disposable;
its purpose is to make the desired experience concrete enough to challenge
the implementation.

The shared scenario set covers:

1. Install the package and reach a working, deployed application.
2. Send, edit, paginate, search, and upload while another user makes changes.
3. Lose connectivity, close the application, reopen it, and reconnect.
4. Change accounts or permissions while work is pending.
5. Add a field and deploy while older clients and queued writes still exist.
6. Diagnose a failed background operation and restore a backup.

As implementation proceeds, turn these scenarios into executable examples.
Use the same ordinary public interfaces an outside builder receives.
Platform-specific application scaffolding and repair helpers count as part of
the application cost even when supplied by a template.

Begin with one coherent app and a small number of interactions. The second
application tests generality once the first slice works; this proposal does
not require two complete applications before the first useful experiment.

## 5. Ownership before abstraction

For every abstraction, ask whose job its behavior should be.

| Responsibility | Proposed owner |
| --- | --- |
| Visibility, retention promises, conflict policy, and product interactions | Application author |
| Types, dependencies, valid plans, and relationships that can be established mechanically | Compiler |
| Subscription sharing, durable operation identity, retry coordination, synchronization, resource renewal, and reconciliation | Runtime and SDK |
| Clear rendering of loading, pending work, failure, recovery, and unavailable data | Client APIs and reference components, with application control over presentation |

A useful abstraction removes a responsibility from application code.
Moving the same coordination into another application helper is a smaller
improvement. Measure decisions, duplicated facts, lifecycle owners, and
correction work across the whole application and SDK.

### Composed reads

Adding an unread count to a conversation should have a clean way to preserve
independently authorized messages when the count is unavailable. Unknown
totals must remain unknown. Rendering independently supported values must
not fabricate a complete composite, imply one common snapshot when sources
differ, or keep content visible after its authorization ends.

The architecture must make these distinctions composable. It may derive
relationships when it can establish them; arbitrary projections and product
retention policy must not be guessed. The first screen experiment should
settle how much ordinary rendering can be derived and what remains explicit.

### Writes and user work

Sending should have one coherent lifecycle through local admission, server
settlement, and observation by a query. Durable admission and server commit
remain distinct facts. An unknown response must preserve operation identity
so that recovery does not create a second submission.

Application code should be able to present these facts without implementing
their coordination. Platform recovery must respect deliberate offline use,
account boundaries, and operations that require a user's decision.

Draft lifetime remains product policy. A standard draft pattern should
nevertheless handle page shifts, delayed results, conflicts, and account
changes. Preserving recoverable input must not imply retaining a revoked row
or making sealed work readable to another account.

## 6. Architectural starting points and experiments

Rust and SQLite are starting preferences. Server-authoritative transactions,
durable client storage, analyzable data operations, and shared semantics for
server execution and local prediction are promising foundations. Mechanisms
should earn their place through the reference applications.

Concentrate early investigation on three questions.

### Bounded computation

Compare static certification with designs that combine static analysis,
runtime metering, and resumable work. Every candidate needs enforceable
resource bounds and sound authorization. Metering an online execution does
not prove that an offline prediction is valid or cheap; local eligibility
needs its own sound contract, visible at the authoring site.

Study whether limits can follow actual dependencies and work while keeping
refusals understandable. An aborted transaction, a resumable job, and a
partial read have different meanings; they must not be interchangeable ways
to make a limit disappear. External effects remain outside the data
transaction, with an explicit durable delivery and retry contract.

### The client data model

Test a canonical local store with deliberate derived indexes, durable pending
operations, and explicit coverage and authorization knowledge. Avoid
independent copies of coordination state whose relationships the application
must reconstruct. Derived representations are legitimate when their
ownership, update cost, and memory cost are understood.

Exercise partial availability, pagination, prediction, and cold reopen from
the first real slice. Prefer incremental processing and bounded persistence
work. Shared semantics do not require identical server and client storage
layouts or execution mechanisms.

### Language and effects runtime

Evaluate Quarry through realistic changes, editor support, debugging,
composition, and refactoring. Evaluate any alternative against the same
contracts and application requirements. Familiar syntax alone cannot repay
a hidden difference in behavior.

Test ordinary imported helpers and representative libraries before settling
the effects runtime. Measure compatibility, installation, startup, memory,
and operating cost together. A custom environment must repay those costs.

Spend novelty carefully. Authorization, live data, and offline behavior
already supply substantial original work. Use established infrastructure for
surrounding responsibilities where it serves the product well.

## 7. Performance is part of the architecture

Establish separate budgets rather than a single speed score:

| Experience | Measurement |
| --- | --- |
| First useful screen and warm navigation | Time to useful rendered data; distinguish local availability from server freshness |
| Interaction and sending | Input-to-feedback, durable admission, server settlement, and observation by another device |
| Cold acquisition and reconnect | Full required durable content, required receipt work, and first offline queries; retain first-screen timing separately |
| Client cost | Complete shipped bytes, retained heap, persistence volume, and foreground blocking during background work |
| Hosting | Idle cost, wake-up, active subscriptions, loaded throughput, tail latency, and resource cost |
| Builder loop | Edit-to-feedback, affected verification, and installed-package first use |

Specify hardware, network, fixture bytes, data distribution, cache state, and
concurrent work before a comparison. Record medians, tails, and failures.
Use a fixed dataset for the first slice and test both interactive use and
background acquisition. Follow work through storage, transport, persistence,
indexes, subscriptions, and rendering.

Starting product targets to test are p95 local interaction feedback within
50 ms and p95 warm navigation over available data within 100 ms on the
declared device. These are proposed targets, not measured capabilities.
Feedback must accurately distinguish pending local work from durable
admission. Choose admission, settlement, memory, and footprint budgets with
the first fixture before performance tuning.

The existing 2–3-second acquisition objective is a useful challenge when
running the corresponding Snapback 2 workload with identical requirements.
Do not claim it by omitting persistence, terminal acknowledgements, required
content, or the first offline read. A smaller dataset needs its own result.

Retain fast affected verification and the current repository's loop
constraints while preparing explicit rules for the parallel implementation.
Give footprint allocations deliberate headroom. Evaluate a budget partly by
the engineering effort it consumes and the user benefit it buys; shortening
one file or one entry point cannot establish a total complexity reduction.

## 8. Craft, distribution, and operations

Give one person responsibility for coherence across the compiler, SDK,
reference applications, editor, CLI, documentation, and operating interface.
That owner needs authority to revise interfaces across subsystem boundaries.
Individual implementations remain accountable to the integrated experience.

Use the same concepts across tools. Human-readable and structured agent
output should describe the same event. A failed application operation should
be traceable through its durable work, server execution, and relevant data.
Detailed diagnostics belong where they help builders or operators; end users
need a clear explanation and an appropriate next action.

Design reference applications deliberately: stable lists, preserved input,
keyboard behavior, accessibility, media loading, empty states, and recovery
copy. Distinguish saving on a device from server acceptance when that
distinction matters. Review the actual interactions; passing an acceptance
script does not establish visual or interaction quality.

Write the conceptual introduction, discoverable API surface, and complete
examples alongside implementation. An outside builder should accomplish
ordinary work through the installed product. Repeatedly needing a design
document to perform a routine task is a reason to inspect the interface.

Put a small application on one real hosted target early, with authentication,
secrets, persistent data, inspection, and backup/restore. Serving an existing
application should not depend on continuous availability of the management
interface. Exercise schema evolution with existing data, an older client,
and pending work. A code rollback and a data restore need clearly different
contracts.

Introduce a minimal native client early enough to test process death,
durable storage, and media. Browser behavior alone cannot settle those
contracts. Additional hosting targets and a broad administrative console can
follow demonstrated need.

## 9. A parallel implementation with clear boundaries

The proposed source home is `snapback3/`, with its own dependency/build
workspace and orientation entry point. Use distinct package and command
identities, data directories, credentials, ports, and process ownership so
the experiment can run alongside Snapback 2 without sharing mutable state.
Read previous code and reuse suitable pieces deliberately; avoid runtime
dependencies on mutable Snapback 2 internals.

LLP 2000 is the author-requested numbering boundary. Future Snapback 3 design
work should use the 2000 series, with sub-LLPs for refinements of this
proposal; the 1000 series remains Snapback 2's home. Record the routing in
the project instructions when the implementation directory is introduced.

The current [repository rules](../rules/RULES.md) literally cover LLPs
numbered 1000 and up, and the [scope list](../rules/NOT-DOING.md) describes
Snapback 2. Creating LLP 2000 does not silently alter those files. The initial
implementation setup should make the Snapback 3 boundary explicit in the
root routing and applicable rules, preserving Snapback 2's existing scope
and checks. Hypotheses in this Draft do not create new blocking gates.

Start with this proposal, a small orientation entry point when code exists,
the executable examples, and a concise experiment record. Add design
documents when a concrete decision needs preservation. Prefer updating this
document while its scope still covers the work.

Snapback 3 begins independently of Snapback 2's application and storage
formats. The experiment still needs to evolve its own persisted data and
clients; repeatedly resetting the fixture would bypass the day-two question.
Promotion or migration from Snapback 2 is a separate later decision for the
author, informed by the parallel results.

## 10. First implementation experiment

Use a private conversation with paginated messages and an unread count as
the first concrete screen. Include two principals and two clients, a fixed
cold-acquisition dataset, and durable pending edits. Expand to photo messages
and an external effect after the initial data lifecycle works.

| Stage | Deliverable | What it resolves |
| --- | --- | --- |
| Experience prototype | Desired application code, screen behavior, tool output, and a fixed scenario/fixture description | Makes the intended simplicity and product contracts reviewable; mocks stay identified |
| Real data slice | Actual server, client store, composed live screen, offline edit/reopen/replay, acquisition, and additive schema change with pending work | Tests ownership, composition, continuity, and the expensive architectural assumptions |
| Complete small lifecycle | Installed package, one real deployment, inspection, backup/restore, a retrying external effect, and a minimal native/photo path | Tests distribution, operations, and platform boundaries before broad feature growth |
| Independent use | A fresh builder uses the package, then the second reference application tests the abstractions | Reveals hidden knowledge and overfitting to the first application |

The real data slice has these observable outcomes:

1. Adding the unread count does not destroy access to messages whose
   independent read/retention contract still permits display. Missing count
   knowledge is represented honestly.
2. A submitted edit has stable identity and survives restart after durable
   admission. Response loss, replay, and query observation do not duplicate
   its effect. User input remains recoverable after a meaningful refusal.
3. Acquisition finishes the fixed workload's durable obligations; a
   foreground send remains measurable while acquisition runs. Record latency
   failures even when the resulting content is correct.
4. An additive field change preserves data and handles queued work according
   to an explicit compatibility contract. A policy-changing control tests
   that useful reuse does not retain invalid authorization.
5. Page shifts and delayed responses preserve the declared draft behavior;
   an account change cannot expose the previous account's content or work.

The first coding task is to create the experience prototype and the smallest
real data slice together, shortening the feedback between desired behavior
and implementation. Select one initial mechanism per unresolved question;
build an alternative only where the slice reveals a material tradeoff.

## 11. Evaluation, verification, and decisions

Compare the slice with the equivalent Snapback 2 experience. Record the
package versions and scenario at the start of each run. Both implementations
may keep evolving between runs; neither needs to wait for a quiet main
branch. Repeat affected measurements when their semantic inputs change.

Keep data volume, authorization, retention, durability, and required
interactions comparable. Report differences in supported capabilities
explicitly. A weaker guarantee or omitted workflow is a tradeoff, not a
performance improvement at fixed requirements.

Measure application decisions, custom coordination, repeated declarations,
correction loops, time to completion, and the cost of a subsequent change.
Count framework-specific helpers wherever they live. Inspect the resulting
interfaces directly. Fresh builders use the published package without
internal-document guidance or implementation-team rescue; assistance, when
necessary, becomes part of the record.

Build deterministic simulation into stateful components early. Exercise
network interruption, delayed responses, storage failure, crashes, account
changes, reconnects, and upgrades using reproducible seeds. Exercise both
safety and eventual progress after faults end. The useful precedent is
[TigerBeetle's simulation of real implementation code](https://github.com/tigerbeetle/tigerbeetle/blob/main/docs/ARCHITECTURE.md#simulation-testing).
Use real browser and device tests for the boundaries simulation cannot
establish. Keep fast affected checks and scheduled deeper work in the
existing verification model instead of multiplying release apparatus.

Continue expanding Snapback 3 when the slice shows a materially simpler
ownership model, coherent user behavior, and credible performance without
concealing weaker contracts. Revise the design when application bookkeeping
returns, routine edits cause unrelated repair work, or critical costs miss
their budgets. Stop or transfer useful improvements to Snapback 2 if the
experiment mostly reproduces the same obligations without a compensating
benefit. A mixed result should name the gains and remaining costs.

The desired result is an outside builder producing a polished, deployed
application whose ordinary changes remain local and unsurprising. A smaller
core, a completed feature inventory, or a favorable aggregate score alone
does not establish that outcome.

## 12. Open questions

1. Which part of the current certification model is essential to the desired
   product contract, and which cost can be enforced differently with less
   application distortion?
2. What representation makes independently known query values easy to compose
   while preserving authorization, completeness, and snapshot distinctions?
3. How much presentation and mutation targeting can be derived soundly, and
   which decisions should stay visibly authored?
4. Does Quarry earn its total tooling and learning cost in the reference
   applications, and which effects runtime provides the best complete loop?
5. Which device, hosted target, dataset, and explicit retention/conflict
   contract best expose the first slice's tradeoffs?
6. What minimal native and operating surface is sufficient to challenge the
   architecture before adding more features?

Resolve these through the first slice and record selected mechanisms and
their evidence here. The experiment begins with a product promise and
concrete interactions; its final architecture remains something to discover.

## 13. First implementation choices

Work lives in `snapback3/`, with independent Cargo and Bun workspaces and
private per-application state in `.snapback3/`. Snapback 1 stays in its existing
root layout. Snapback 2 and Snapback 4 stay independent sibling directories.
The copied compiler, Rust core, evaluator, Unicode data, and corpus come from
Snapback 2 at `a93edb979a5cbe6357f1fc1f95b66f85bd308844`; copying that foundation
preserves tested semantics while the product's division of responsibility changes.

Start with Quarry and existing static certification. Use Rolldown for bundles
and TypeScript for type checks. A Node owner manages compilation, HTTP, and
the development loop; a private Rust child owns the SQLite connection and
executes certified operations serially. Only named authenticated operations
reach clients. Private traces, raw storage, seed installation, and successor
installation are not public HTTP APIs. Unsupported runtime capabilities are
refused at admission, even when inherited syntax can compile them.

The client owns independently complete query resources, a shared normalized
authorized fact pool, and evidence for local evaluation. Completeness and
freshness remain separate. Evidence from different revisions is not silently
combined into a current snapshot. Missing summary evidence produces an unknown
summary, and does not erase known messages. Receipts are SDK implementation
details. This is the first alternative to the partition replica proposed in
[LLP 2000.000](./2000.000-keep-the-core-flip-two-substrates.rfc.md).

The Node owner sends complete, independent resource replacements over an
authenticated POST SSE stream. Reads in one owner batch share its sequence;
errors belong to the affected resource. Ordinary commits refresh values directly
without a whole-screen invalidation gap. Connections have bounded demand, frame
size, backlog, and heartbeat authentication. Account changes, old sequences, and
superseded manifest responses are fenced by the client.

Positive fact admission stages only the incoming batch, persists it in one
IndexedDB transaction, then publishes it. Normalized row and resource stores avoid
rewriting the complete cache for every page. A denial or negative projection change
redacts previous data immediately, including when persistence fails; the client
attempts a smaller durable cache clear and keeps the error visible. Resource-owned
projection identity survives fact-pool renewal so a complete empty result cannot
accidentally leave a revoked row on screen. Durable terminal sequences constrain
cold reopen as well as live delivery.

The served surface currently includes authenticated persisted queries and
mutations. Clock-sensitive live queries and connected presence are refused along
with effects, jobs, schedules, channels, and media because their live/runtime
owners do not yet exist. Mutation timestamps work. Compiler acceptance alone
does not widen this runtime contract.

Fixture import is a private administrative path with a 64 MiB input limit,
150,000 supplied rows, 10,000 personas, and explicit larger certification budgets
that account for maintained writes. Ordinary operation ceilings remain unchanged.
Imported application rows still pass the same validator and commit atomically.
The new seed API leaves the inherited ordinary seed budget unchanged; native
delivery expansion still applies its inherited custody budget. The present hub
fixture has no delivery declarations.

### Durable operation ownership

The application requests a mutation once. Before transmission the client
durably saves an immutable operation ID, program identity, and arguments.
The server authenticates every attempt and scopes identity to that principal.
It looks up a stored terminal before resolving the current program: a lost
reply remains recoverable after an upgrade. Reusing an ID with different
request content is refused. An uncommitted operation whose program identity
changed is parked for an explicit resolution, never silently reinterpreted.

Mutation data and its terminal receipt commit in the same SQLite transaction.
Generated row IDs derive deterministically from the principal, intent, and
ordinal, so retry needs no client grant allocator. The operation ledger has
no automatic age-based deletion: any future retention policy needs an explicit
expiry contract that also prevents an expired ID from executing again.
Legacy grant replay remains an internal inherited compatibility path, not a
second public write protocol.

IDs are allocated lazily as an operation consumes them, with a 4,096-ID bound,
rather than constructing a full grant-sized string queue for every mutation.
After the terminal receipt is durable, an `observing` phase keeps accepted work
visible until relevant active queries have observed its commit. A removed query,
account transition, or new program generation cannot strand that phase. Transient
transport and owner-capacity failures preserve the same identity for retry;
application refusals and program-identity changes have explicit terminal or parked
states. Retained operation handles are sealed across account changes.

Commonroom owns its offline application shell separately from client data. A
successful first online visit installs integrity-checked, versioned HTML, JS, and
CSS. Its service worker never caches API responses and activates updates after
older tabs close, without forcing a reload. The real-browser witness disconnects
the entire network, closes and reopens the page, and recovers the same saved
operation exactly once after reconnect. A separate update witness checks waiting
workers, cache boundaries, and draft continuity.

The hub fixture and day-two changes belong in early evaluation, as Fable's
critique proposes. None of these implementation choices establishes a win:
measure a working screen, durable recovery, acquisition cost, and the builder's
whole experience before treating them as settled improvements.

The first implementation, its observed friction, and the scoped hub measurement
are recorded in [Diary 0120](../diaries/0120-snapback3-commonroom.diary.md).
The working slice and [builder guide](../snapback3/guide.md) provide the starting
point for further implementation and the sibling comparison.

## 14. Response to the completed Snapback 2 diagnostic wave

Charlie supplied the completed [LLP 1023 wave report](../benchmarks/runs/2026-09-12-snapback2-clique-0029/README.md)
after the first S3 implementation had landed. Its conclusion matters more than
its green subtests: substantial capability did not establish the desired jump in
whole-application quality or builder experience. Both later poll exercises passed;
the apps were not subsequently regraded as complete, corrected products.

The first S3 slice changes client ownership, while retaining important sources of
S2's costs. These are the current boundaries and the next useful comparisons:

| Concern | What S3 currently establishes | What still needs evidence |
| --- | --- | --- |
| Client coordination | Commonroom creates one client. The SDK restores saved state, owns independent query resources and write recovery, and distinguishes unavailable counts from zero. Its browser journeys exercise that app | A fresh builder adding a composed screen and an offline poll without additional authenticated readers or custom coverage/retry machinery. Count auth presentation, drafts, route handling, and helpers as application work |
| Cold acquisition | Batch persistence updates normalized rows/resources incrementally. The hub measurement reads the complete declared worker fixture | Complete browser acquisition through HTTP, JSON processing, evidence/index construction, IndexedDB completion, closed-page reopen and the first offline query; peak/retained heap, long tasks, and foreground sends during acquisition |
| Server storage | The generic SQLite index representation is inherited, including its table, primary-key autoindex, lookup index, and row-cleanup index | Attribute pages, repeated key bytes, search data, and delivery/operation records on a comparable fixture; measure a representation change against the same lookup, write, deletion and authorization requirements |
| Ordinary authoring | Quarry and static certification remain. The private large-seed path has explicit larger budgets | Cross-room search, exact changing digests, and a populated backfill while old clients have queued work. A successful administrative import does not establish an ergonomic migration API; jobs/effects are not currently served |
| Byte headroom | S3 has its own build and does not import S2's frozen runtime ceiling | Measure the browser SDK closure, complete app, and installed distribution separately; choose explicit budgets with maintenance room. A native-inclusive tarball size cannot stand in for browser cost, and removing a ceiling cannot establish efficiency |
| Product and test quality | Five real-browser journeys cover the stated Commonroom workflows, including actual network disconnection and reopening | Complete visible workflows with independent expected values, reachable navigation, required pagination/deletion semantics, transient media recovery, and preserved migration fields/receipts. Unsupported workflows stay explicit omissions |

S3's recorded 3,899 ms for 100,015 message rows is a worker/JSONL measurement,
with 62,814,275 response bytes. It excludes browser work and uses a different
fixture and host from the S2 app's 62,217 ms / approximately 748 MB observation.
These numbers establish no comparative acquisition improvement. Likewise, S2's
5.2 GB file and 70.020% generic-index attribution are evidence to investigate
the inherited representation, not a measurement of S3's database.

### Applicable correctness repairs

The initial S3 fork predates the fixes qualified for S2 0.0.31. Inspection found
both relevant old code paths in the copied evaluator and compiler. Focused
regressions reproduced the failures in S3 before the repairs were applied:

- An exhausted, correctly scoped public unique-key range did not discharge a
  missing point read. The port from S2 `2d847b7e9ef794ba5860742376f482f470123d39`
  accepts that existing read evidence while preserving the distinction from
  negative rule/write authority. Wrong scope/rule, bounded/truncated or evicted
  evidence, removed receipts, and restricted reads remain incomplete. The
  synthetic evaluator controls also cover negative write refusal and a surviving
  noncanonical row. These controls are not a new real-owner or browser poll run.
- Unsupported comparisons in read and channel rules recommended a write-only
  mutation precondition. The same source repair now distinguishes read/channel
  authority from insert/update/delete preconditions. S3's message does not direct
  the builder to S2's absent `guide rules` command. Tests exercise all four
  comparison operators through the built compiler API and preserve refusal
  code, family, location, and a valid mutation comparison. Channel runtime
  admission remains unsupported.

The S3 resource layer preserves its directly acquired complete answer without
requiring that answer to be reconstructed from other evidence. This is a
different boundary from S2's failed mixed-answer path, but inferred local reads
still use the inherited evaluator. Replacing the SDK was not sufficient reason
to assume the evaluator repair was irrelevant.

### Next discriminating experiment

Prioritize a browser acquisition profile and a server storage breakdown before
claiming that the new client architecture fixes scale. Define the required
durable dataset and fixture identity first. Separate the application's
subscription demand from SDK processing; keep first useful screen, full
acquisition, and offline reopen as separate results. Only compare variants at
equal requirements and with declared hardware/network conditions.

Then test a day-two feature and schema change through an outside builder using
the public package and guide. Require actual user-visible values and record the
workarounds needed. Preserve safety controls for authorization, revocation,
expiry and purge where those capabilities are supported. The favorable S2
security results do not transfer automatically to S3's new transport and cache.

Assertions must require their preconditions and find items across the declared
pages. Retained results bind the source and scenario they ran; assessor output
belongs outside builder-owned status inputs so grading cannot change regression
selection. A focused green receipt does not replace a whole-app assessment.
These additions refine the existing experiment; they neither declare S3 the
winner nor require a new release-gate system.

## 15. Focused Clique evaluation

The first [outside-builder attempt](../benchmarks/runs/2026-09-12-snapback3-clique-astra-medium/README.md)
used Astra medium and the qualified private Linux package at source
`409954115f151a72dd95e897c5f00f36877f11e0`. It built a text account/profile
slice, but the full instrument stopped at M1's required avatar capability.
The required suite passed five of seven assertions; three browser choreography
checks passed. The independent, uncalibrated Opus 5 assessment also found
intermittent silent logout failure and authentication rate limiting in the
documented seed/acceptance sequence. No messaging or performance outcome was
established by that attempt.

Charlie then explicitly requested the Clique scenarios concerning client
coordination and performance without making avatar uploads a prerequisite.
The [focused run](../benchmarks/runs/2026-09-12-snapback3-clique-focused-astra-medium/README.md)
is a new diagnostic variant with its scope frozen before a fresh Astra medium
session. It starts from the prior frozen text account/profile source, without
prior narratives, grades, receipts, runtime data, or installed dependencies.
The package and public guide remain fixed; implementation-team assistance and
platform patches are excluded from the builder experiment.

The selected work exercises independent resources through one client, browser
offline close/reopen and durable sends, same-account convergence, starter
Insights correctness, and browser acquisition, paging and storage. A separate
fresh session adds polls and backfills counts in a populated starter database.
Each selected result stands independently; missing media, presence, push,
scheduling, or native support cannot block unrelated checks. Selected failures
must still be recorded, and browser analogues cannot establish native behavior.

The large messaging projection preserves identities, membership, quoted
references and reactions while converting media messages to labeled text.
It contains 1,002 conversations and 100,015 messages globally; the hub can
read 100,000 messages and the other scale probe 10,000. First useful UI,
complete durable acquisition, offline reopen, and foreground send phases are
separate measurements. Server storage attribution names the projection and
cannot be compared directly with the prior full app's 5.2 GB total.

The frozen [scope](../benchmarks/runs/2026-09-12-snapback3-clique-focused-astra-medium/SCOPE.md)
defines repeated attempts, timeouts, field-complete persona snapshots, populated
migration controls, and independent checks. This run does not earn full Clique
milestone passes or a weighted score.

### Continuous-session results and design consequences

The independent assessment verifies one ordinary app client, restored
authentication, account isolation, same-account messaging and the selected
starter offline close/reopen workflows. A denied unread resource renders
Unknown while authorized messages remain usable and a send settles once.
Starter Insights totals, seven-day buckets and the exact increment from a new
like are independently checked. Rendered positive-to-zero unread convergence
and a delivered-only UI state remain unproven. A retained whole-HTTP-batch
failure is builder-observed and unresolved, not an independent reproduction.

One client did not remove all application coordination. The builder authored a
serial page walker, bounded waits for in-flight resources, unread calculation
over a bounded summary and explicit acquisition before offline use. Fresh
paged data sometimes carried `complete: false`; the builder changed its
readiness predicate and independently checked exact IDs. The
[guide-gap ticket](../snapback3/issues/20260912-guide-gap-paginated-resource-readiness.md)
requires the public readiness semantics and acquisition example to be brought
into agreement. These responsibilities count against the product hypothesis,
even though no extra authenticated app reader or private cache was added.

The browser measurements invalidate any inference of complete acquisition
performance from the earlier 3,899 ms worker result. Final 10,000-message
builder acquisitions take 32.649–33.646 seconds, with 33.573–34.571 seconds
including initial online setup. All three final 100,000-message attempts time
out at 180 seconds, as does the independent repetition. A separate instrumented
CPU profile identifies material SDK, React and persistence-await work; its
single no-send timing is not a replacement cohort or an additive wall-time
breakdown. The run retains both useful first-screen latency and full acquisition
failure.

More seriously, two independent later-send controls fetched all 10,000 expected
IDs but made 9,800 inaccessible through offline pagination after page reopen.
A startup-send control retained the full history. Server data remained intact.
The current sequence-wide storage and fact-pool fences are consistent with
replacement by the currently admitted resources. The
[retention issue](../snapback3/issues/20260912-acquired-history-lost-across-sequence-advance.md)
requires an explicit durable-dataset contract that survives ordinary writes
while preserving authorization, revocation and completeness. A fetched-ID
accumulator and a passing first offline page cannot certify that contract.

Storage remains an inherited cost: the generic index family occupies 55,689,216
of 113,262,592 logical database bytes (49.17%). The static seed's touched
inventory dominates the commit table; the projection omits full social scale
and per-message public-mutation receipt load. The
[acquisition/storage issue](../snapback3/issues/20260912-browser-acquisition-cost-and-storage-amplification.md)
records the profile, heap boundaries and physical byte attribution without a
comparison to Snapback2's full database. These results support further work on
client ownership and storage representation, not a declaration that either is
solved.

Assessment itself needed a correction. The first independent rapid-navigation
probe ended on the group and immediately asserted a DM-only message. Its
timeout was expected under correct isolation; the corrected probe selected the
DM and passed. The raw report is retained with a separate
[coordinator disposition](../benchmarks/runs/2026-09-12-snapback3-clique-focused-astra-medium/coordinator-audit.md).
Independent model output is evidence to audit, not an authority that can turn
a bad precondition into a product defect.

### Fresh-session change results

The fresh Astra medium builder added polls and a persisted count backfill in
976 seconds. The independent assessment supports the nine selected M7
assertions and reran the 25 prior passing regression IDs. Its public migration
replay preserves the original database and principals, backfills both existing
conversations, and checks visible counts DM6/group9 → group10 after a poll →
group11 after a text. Required fields in all 42 persona-visible records remain
unchanged, with populated timestamps, reactions, replies, receipt, edit and
tombstone controls. The original offline vote survives browser close/reopen and
settles without duplicate tally growth. Earlier UI qualifications and large
acquisition failures remain; they are not displaced by the M7 passes.

The migration only supports up to 200 visible messages per conversation; no
larger resumable backfill was supplied or exercised. The builder corrected
compiler errors and changed a bounded vote scan into a maintained tally. A
wrong persona list caused its first migration census to fail explicitly; the
independent physical census and correct eight-persona enumeration establish
coverage for this starter database. These are material authoring costs.

The original pre-change queued operation retained its identity after the
migration but did not settle in the independent observation. A separate
coordinator control corrects the grader's invalid operation-state accessor:
the original intent is `parked` with `S3_OPERATION_CHANGED`, unchanged through
25.036 seconds online, with no server message. The guide's promised parked
dismissal conflicts with the implementation's terminal-receipt requirement;
the recovery issue records that gap. The control also corrects a false denial
finding by preserving the actual resource status and `NOT_MEMBER` error.
There is no automatic-compatibility pass. The
[M7 report](../benchmarks/runs/2026-09-12-snapback3-clique-focused-astra-medium/m7-grader/grading/grader-report.json)
and coordinator dispositions preserve raw failures and distinguish test errors
from product limitations. This completes the selected experiment, not the
whole product or a comparison win.

## 16. Making acquisition fast

Charlie identified acquisition time as a primary concern during the focused
run and asked what could make it fast. The response is a concrete optimization
program, with the measured endpoint kept fixed. The SDK-owned bulk path now
exists in the working implementation. Final candidate v8 completed ten alternating
pairs with a **2.807-second median**, versus **6.875 seconds** for the fixed serial
baseline under the same harness. All full-message-row audits and physical
offline reopens passed; one candidate run exceeded three seconds (range
2.461–3.046). This meets the declared median target with about 59% less elapsed
time. The first inbox appeared at a median of 435ms. Its full 100k control passed
in 23.825 seconds; the shaped 10k control passed in 5.421 seconds. These larger
and network costs remain above three seconds. Earlier candidates and their
review defects remain in the record; they do not qualify the final source.
The original benchmark package stays fixed, and no per-run latency guarantee
or comparison win over Snapback2 or Snapback4 is established.

### Target and measurement contract

The first engineering target is **a candidate median under three seconds for
the complete 10,000-message workflow** on the checked EPYC browser host with a
local owner. Every repetition must complete correctly; report slower individual
runs explicitly rather than treating the median as a per-run guarantee.
The endpoint includes the exact authorized dataset, required query evidence,
durable admission, required index construction and the first offline history
query and substring search of its acquired page. This does not qualify a
full-dataset cross-chat search index. The clock starts before loading the client and its automated
authentication using the fixed fixture's existing auth route; fixture preparation
and human typing are outside it. Any receipt obligations of the declared
workflow must also be complete. Report authentication, first-use and inner
acquisition intervals separately without substituting them for this total.
Physical offline close/reopen is additionally timed and must preserve the same
content; it is a distinct control rather than hidden preparation for the primary
timer. The current projection has no per-message delivery
acknowledgement stream, so qualification at this scope does not establish the
cost of adding that feature later.

First useful content should appear substantially earlier than full acquisition.
The 100,000-message account must complete and retain its entire declared data;
its scaling, first-use latency and memory remain explicit qualification rows.
Meeting the 10k target cannot stand in for that result. Measure a shaped network
as well as localhost so request round trips and compressed byte volume remain
visible. A first-page-only cache, a smaller dataset or an unbounded background
queue does not satisfy the complete endpoint.

Use fresh browser storage, a production app build, fixed fixture and source
identities, the same owner/compiler and recorded host load. Start with short
diagnostics; qualify the resulting candidate with ten alternating pairs (ten
runs per variant), preserving every failure and cutoff. Report medians and
ranges without calling ten samples a population p95. Keep profiling hooks out
of the ordinary cohort. Offline physical reopen and foreground writes are
correctness controls alongside the timing, not optional later checks.
Here cold means a fresh browser profile, storage and navigation; the local
owner is already ready and server/OS caches are not flushed. The primary timer
forces the SDK offline while leaving browser instrumentation connected. A
separate physical reopen disables the browser network and requires the cached
application shell plus the full content audit. Keep these boundaries explicit.

### Why the current path is expensive

The [separate instrumented profile](../benchmarks/runs/2026-09-12-snapback3-clique-focused-astra-medium/profile/README.md)
acquires 10,000 messages across 100 conversations and 151 pages. It records
151 completed main-page API read responses carrying 25,072,206 encoded bytes,
and 151 storage writes during acquisition carrying 85,697 row entries. Row entries
include supporting facts and repeated occurrences; they are not 85,697 unique
messages. Most conversations in this probe are empty, but the authored walker
still performs their individual reads. Acquisition currently follows ordinary
interactive page boundaries all the way through transport and persistence.

SDK self samples account for 6.124 seconds, React for 2.832 seconds, other
framework/helpers for 2.692 seconds and GC for 1.334 seconds. Persistence-await
intervals total 8.037 seconds. These overlap process CPU and other activity;
adding or subtracting them does not predict the resulting wall time. Source
mapping remains partial. The numbers identify repeated data handling, browser
publication and many small storage transactions as concrete investigation
targets, while the Node owner and Rust worker consume 1.08 and 3.22 CPU-seconds
in the same profile interval. Server CPU improvements alone cannot establish
the browser target.

### Implementation sequence

| Step | Concrete experiment | Evidence required to retain it |
| --- | --- | --- |
| 1. Establish the browser data cost | On the fixed authorized fixture, measure a compact export through transfer, decoding, IndexedDB and the first offline queries. Count unique facts, repeated row/evidence bytes, preparation calls, index visits and publications in the current path | A diagnostic feasibility result with explicit omitted machinery, never a product qualification. Determine whether transfer, storage or representation already prevents the target before building a larger subsystem |
| 2. Make acquisition one SDK responsibility | Provide an SDK-owned operation for a declared offline dataset: traversal, bounded scheduling, durable progress, cancellation/resume and completion. Ordinary interactive queries continue to serve the visible screen | The Clique builder can replace its serial page walker and in-flight readiness loop with the supported operation, without adding readers, private caches or mutation reconciliation |
| 3. Use a compact, bounded bulk delivery path | Let the owner advance existing authorized reads across several page/room boundaries per request. Share repeated rows, schema and evidence within an explicitly bound acquisition unit; measure normal HTTP compression. Bound response bytes, row count and owner work, and yield between units | Fewer requests and repeated bytes at the same authorization and completeness requirements. Empty rooms still need truthful absence evidence. A limit or interruption exposes a resumable prefix, never false completion |
| 4. Prepare and persist changed data once | Reuse validated owned representations and indexes within their schema/program/authority lifetime. Deduplicate repeated facts at the admitted identity/version. Commit a bounded group in one IndexedDB transaction and publish only after it succeeds | Algorithmic counters show work proportional to new or changed facts, plus genuine boundary/authority work. No repeated full-pool clone, rebuild or scan per chunk. Failed persistence and reopening preserve exact durable custody |
| 5. Bound publication and preserve foreground work | Publish useful query changes and periodic acquisition progress instead of driving the entire app for every internal row/page event. Keep background concurrency and memory bounded, yielding to user writes and visible resources | Responsive first content and sends under acquisition, with all final results observable. Deletion, denial, account changes and terminal operations cannot disappear inside coalesced updates |
| 6. Qualify the complete path | Run the fixed full endpoint, offline reopen, sends at early/middle/late acquisition, and 1k/10k/100k scaling cases | Exact content and evidence, no missing offline pages, no lost/recreated operations, scoped latency and memory results. A faster fetch counter without retained data fails |

The compact-export experiment is isolated evaluation code using a known
authorized fixture. It cannot become a production bypass around read rules,
closure validation or revocation. It answers what the browser representation
costs, then the real path must reach that neighborhood with its obligations
intact. Keep each step measurable; reject an optimization whose improvement
disappears at the complete endpoint.

### Retention and authority are part of the speed work

The current whole-frame sequence fence discards earlier acquired resources
when a later sequence arrives. The two delayed-send failures demonstrate that
speed and retention cannot be qualified independently. Define durable retained
facts, a query's snapshot/completeness evidence and its current freshness as
separate responsibilities. Ordinary writes should update or invalidate their
affected state without erasing an otherwise usable acquired dataset.

That separation requires a sound protocol boundary, not merely deleting the
sequence equality check. Each bulk unit must keep its principal, auth epoch,
schema, program, real sequence and cursor identities. Deduplication cannot join
contradictory versions, infer missing negative evidence or turn observations
from different sequences into a common snapshot. If acquisition spans commits,
the owner must provide a qualified continuation/change boundary or explicitly
require reacquisition; it cannot invent a maximum-sequence proof over older
pages. Denial, account changes, revocation and generation changes must still
take effect through failure and interruption.

Keep a durable resume cursor with the data/evidence it certifies, in the same
atomic admission. Never hold an IndexedDB transaction or SQLite read snapshot
across a network wait. Foreground operations retain their original identity,
durable admission and settlement behavior while background acquisition yields.
The SDK owns those transitions so every application does not design them again.

### Reuse and decision points

Adapt useful Snapback2 work: [incremental bookkeeping and publication](./1018.008.007.001-acquisition-with-incremental-work.plan.md),
[bounded transport/commit grouping](./1018.008.007.002-bounded-bulk-acquisition.plan.md),
and measured preparation/index reuse. Fit it to S3's existing resource and
operation owners. Its [remaining acquisition record](../issues/20260911-snapback2-full-acquisition-and-foreground-send.md)
also warns against expecting batching alone to reach three seconds: later
individual diagnostics still took about 25 seconds and did not qualify that
target. Those measurements use a different receipt-bearing workflow and are
not S3 comparison samples.

After the compact path and first integrated candidate, inspect the residual.
If certification, repeated local reconstruction or the storage representation
still dominates, change that boundary deliberately and compare it at equal
requirements. Do not keep accumulating minor optimizations around a structural
cost, or hide required work after the completion signal. A worker/WASM move is
an experiment only if the measured residual warrants it; moving the same work
off the main thread may improve responsiveness without improving completion.

### Compact browser diagnostic

The [lossless-row diagnostic](../snapback3/benchmarks/acquisition-floor/README.md)
retained all 100 conversations and 10,000 message objects returned by the
fixed package's authorized public queries. The payload was 1,916,522 JSON bytes
and 93,198 bytes with ordinary gzip. Three fresh-browser repetitions took
1,358.3, 1,231.2 and 1,413.6 milliseconds from before navigation through transfer,
decoding, eleven grouped IndexedDB transactions, history and simple token-search
indexes, a same-page database connection reopen, and the first local queries.
The median was 1,358.3 milliseconds. A subsequent full-row readback digest
matched the original SDK rows in every repetition; that audit is outside the
primary timer.

This establishes feasibility for those browser costs, not a product result.
Authentication and authorized extraction happened during untimed preparation.
The fixture-only endpoint omits runtime authorization, query evidence, SDK
indexing and publication, resume, foreground writes and UI rendering. The
transactions requested relaxed durability; their completion does not prove
OS-crash durability. A separate browser-reopen control used the earlier tuple
payload and loaded its control page online before disabling the network. It
does not qualify reopening the actual application shell while offline. Earlier
tuple cohorts, timing-boundary corrections and harness failures remain in the
record. The complete candidate must restore these omitted obligations.

### First candidate design

The selected public shape is `client.acquire({ id, revision, root, expand })`,
with `pages(op, args)` declaring a paginated query and an optional `expand`
deriving further page chains from the complete root result. Applications declare
the dataset once; the SDK owns traversal, cancellation, durable continuation,
resume and completion. Registration captures the identifier, revision, an
immutable root with deeply owned arguments, and the expansion function reference.
Later mutation of a caller's declaration cannot redirect an existing handle or
its cancellation to another dataset. A stable revision identifies application
derivation code that cannot itself be hashed; capturing a function does not
freeze mutable values in its closure. Root and derived declarations are checked
again on resume. These internal reads do not become additional live screen
subscriptions.

The finite `POST /api/acquire` path advances ordinary authorized queries. A
request contains at most 64 runnable declarations; each owner turn performs at
most 32 executions, yielding between complete pages after a soft 20ms or 1MiB
budget. A 15MiB hard response limit protects the worker frame. A legal first
page may exceed a soft budget. Every page and the final response must have the
same real commit sequence and program generation. Continuations include their
complete runnable declaration. Neither an ended transport batch nor a capped
page without a next cursor proves dataset completion. Gzip is negotiated on
the ordinary HTTP response. The first candidate keeps full existing delivery
envelopes; shared wire dictionaries remain a measurement-driven follow-up.
The earlier 16-execution limit ended six consecutive empty-room turns in each
v3 diagnostic while measured HTTP wall time remained below 20ms and payloads
were below 81KiB. Raising that count to 32 retains the work and byte limits;
the v5 and v6 measured cohorts and early/middle/late foreground controls
include this limit. Later candidate measurements remain source-bound.

IndexedDB version 2 adds separate acquisition metadata, content-addressed row
versions and per-query evidence. A bounded response's data and continuation
advance atomically. Acquired facts enter an evaluator pool only when every
required page is coherent at one real sequence. Conditional revalidation first
executes the authorized query and may then return an unchanged validator;
validators bind the original query, authority, contents, evidence and cursor.
This can retain unchanged physical rows across commits without granting old
evidence a new sequence by assumption.

An uninterrupted fresh traversal can already supply that common-sequence proof.
The SDK may omit the extra conditional pass only when the exact reachable page
set was newly delivered in full at one real expected sequence, with its captured
authority epoch still current. This permission exists only in memory; it is
never restored from a progress record. Resumed prefixes, unchanged replies and
invalidated work retain conditional normalization. Time-dependent and connected
queries cannot declare a durable acquired dataset. Atomic persistence and the
final authority check still precede ready publication.

A known newer commit or generic invalidation immediately suspends eligibility
of acquired evidence. A durable floor prevents an immediate offline process
reopen from reviving it. Reconfirmation restores eligibility; the previous
history need not be physically erased for an ordinary unrelated write. Denial,
account and generation changes remain authority boundaries, including when
positive persistence fails. No IndexedDB transaction or SQLite read snapshot
spans a network wait. The existing operation journal continues to own original
write identities and settlement. A denied dataset withdraws its own checkpoint
without deleting unrelated datasets. Failed authority withdrawals seal current
RAM state and attempt a conditional durable session removal. That removal
matches token, principal and auth epoch atomically, so a late failure after
closing a client cannot erase a newer account session. Cancellation also binds
the stored dataset's identifier, declaration hash, principal, auth epoch,
generation and schema hash. Its failure cleanup uses that same checkpoint guard,
so a successor declaration is preserved. Storage notifications must use the full
conditional-clear predicate: a refused clear cannot broadcast an authority
change and withdraw a subscribed successor's live data. Clients sharing the same
storage adapter instance also share a persistence queue: initialization waits
for admitted withdrawal and conditional cleanup as one job. A close followed
immediately by offline reopen cannot slip into the failed-write/fallback gap.
Distinct adapter instances retain the adapter notification contract. If storage
refuses every write, the client cannot guarantee durable erasure; it must not
republish the withdrawn data in memory. Query resources remember when their
data came from an acquired pool so withdrawing that pool also withdraws an
already displayed acquired result. Ordinary directly confirmed stale display
behavior remains governed by its existing resource contract.

Retained row versions are checked against their actual canonical contents and
table/row identities before reuse. Validation caches hold deeply owned immutable
values, rather than trusting a mutable caller's claimed hash. Acquisition page
results are lists; typed declarations exclude other result shapes, and runtime
admission refuses composite records instead of flattening them into a different
type for `expand`. Repeated walks reuse a decoded envelope only when the resource
and every referenced row are module-owned immutable objects, the frozen manifest
identity/schema/generation match, and every row-key binding still names the
same row object. Missing or replaced bindings cannot inherit the cached proof.
Mutable adapter inputs are owned at the boundary. This removes repeated full
protocol decoding; it does not remove the remaining row-key checks, whole-corpus
adapter loads or per-dataset map construction. Old retained versions still lack
automatic collection, and finite HTTP gzip remains synchronous. Those are
explicit scaling and latency follow-ups.

The acquisition handle exposes a completion promise for its current cycle.
Transient failures suspend that cycle and reconnect resumes it, including when
the server sequence has not changed. Cancellation rejects pending awaiters;
explicit resume after cancellation or a terminal error creates a new cycle.
Repeated resume while active joins the existing work. Deferred automatic
restarts check that the handle is still acquiring both before scheduling and
after client readiness; cancellation during a pending withdrawal cannot be
overwritten by that captured restart. Sealing is permanent for the old handle.
These lifecycle transitions remain SDK responsibilities rather than application
retry loops.

The wider performance work remains open. V8's shaped 50ms, 10Mbit-down,
5Mbit-up 10k run took 5.421 seconds. Its 2.191MB of encoded responses included
about 1.94MB of application code and manifests, versus about 253KB of acquisition
responses. Startup transfer is therefore a concrete next target on that network.
The 100k result remains far above three seconds. Heap samples at completion are
not peak or post-GC retained heap, and a browser database directory's physical
size is not logical data size or write volume. Whole-corpus loads, repeated map
construction, old-version collection and server index amplification remain
unresolved. The planned 1k scaling case is unmeasured in this run.

### Qualification outcome

Retain this implementation at the declared scope. The
[final acquisition record](../snapback3/benchmarks/acquisition-target/README.md)
binds candidate v8 to package
`6eb3ca7780286a861d8e79e0f6e1322c37734036add5078011c6c05a72c44562`.
All ten candidate and ten matched serial trials passed exact full-message
content and offline-reopen checks. Physical offline reopen, including the full
audit, took a candidate median of 1.477 seconds and is outside the primary
acquisition timer. All nine real IndexedDB groups and five foreground/recovery
controls passed, including early/middle/late sends, a lost successful commit
reply with unchanged operation identity, and an interrupted durable prefix.
The 83 focused SDK tests passed with 338 assertions, affected owner/HTTP checks
passed, and both independent review families accepted the final repair delta.

The [coordinator result audit](../snapback3/benchmarks/acquisition-target/coordinator-audit.json)
recomputes the reported cohort statistics and checks its content bindings.
This qualifies the implemented path, not a new outside-builder run or the whole
Clique product. The original package, every failed or excluded candidate, and
the unresolved scaling/storage issue remain preserved.

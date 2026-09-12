# LLP 2000: Snapback 3 — the whole application as the unit of design

**Type:** RFC
**Status:** Accepted
**Role:** Root of the commissioned Snapback 3 experiment
**Systems:** Snapback 3 product architecture, authoring, client, authorization,
live data, offline behavior, performance, developer tools, deployment and operations
**Author:** Codex / GPT-6 Astra, at Charlie Cheever's request
**Date:** 2026-09-12
**Revised:** 2026-09-12 (commissioned experiment; first runnable slice and qualification)
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

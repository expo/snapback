//! The bounds card. Quarry examples are compiled by tests/guide.rs.
pub(super) const CARD: &str = r##"# Bounds and the meter

The meter limits the work each read, mutation and job transaction can do.
Declare product limits; the engine chooses execution bounds within those ceilings.

```quarry
table scalePosts:
  body: text <=500
  public
  online only
query scalePage(c: cursor ?):
  return scalePosts first 20 by .id after c
query scalePopulation():
  return count(scalePosts)
```

Write product limits: a page size, a text length, an asset size or a real
per-group cap. Do not choose an index, a merge width or a job transaction
size. Predicate reads and views choose their plans; top-level job `for`
loops choose their chunks. Removing a written number never removes the meter.

A query's `for row in t where .owner = viewer:` and a merge lane's source may omit `first N`
when the read rule is uniformly decided by that prefix; they read ascending
until the prefix ends or the meter cuts, and `check --cost` prints `rows ≤ meter`
and `lanes ≤ meter` when no fitting schema cap supplies a static bound.
A loop the meter cuts has no continuation; a total over a group that can outgrow one read is a maintained `view`.
A returned or bound page instead needs a schema cap or an explicit page bound.
Jobs may iterate uncapped domains under the chunk's meter. Top-level job
`for` sweeps shrink their transaction size after a meter refusal. Mutation loops
still need a schema-capped group that fits the examined ceiling. Direct
`count(domain)`, `sum(domain, .column)` and `exists domain` stream under the
meter without retaining the page. Schema-capped query `count` and `sum` with
non-uniform read rules keep their bounded page execution and coverage contract.
Mutations retain their uniform-read and
plain-prefix admission rules; a cut aborts the transaction, never commits a
partial total. A streaming query total with a meter cut or unknown device
coverage leaves the client observation `loading`, never a partial count or sum.
Unknown earlier reads also make a streaming scalar unavailable, including
inputs saved in locals or used as domain bounds; a fallback cannot establish
coverage.

For one-shots, see `guide client`.

## Allocation and completeness

Heap is a cumulative allocation and binding budget. Streaming aggregates
release each transient row and its key scratch; one cursor allowance remains.
Inner job domains decode one prepaid row at a time and retain each selected
row under the heap meter before fetching another. Once decoded, the row's
retained allowance replaces its decode scratch. Retained rows, their vector
and the live cursor stay charged; domains do not retain unused result keys.
Constructed values,
concatenation and other allocating builtins, local bindings, and owned
copies count. Inspecting a held value's length or sum borrows it; row and
map clones share their immutable image. A heap cut stops a query immediately
with no available value or continuation, since an interrupted scalar or shape
has no valid partial answer. The client observation is `loading`; narrow the query or
use a maintained view for a total. Its cut site remains internal;
the meter is available only through dev's default read inspection (CLIENT-AND-OPERATIONS.md §4).
An unfinished maintained lookup or live aggregate uses the same unavailable
query result, preserving zero only for a completed missing-group lookup.
A mutation rolls back; Operations below describes the refusal.
A page whose read rule the prefix does not decide (the deciding fields include a
column the scan does not pin) is never `complete`: the server cannot tell
"no more" from "more you may not see". Pin the deciding columns in the predicate, or read the page on the device (`guide sync`), where the
partition holds exactly what the viewer may read. `check` says so
(`N_NEVER_COMPLETE`), as it notes a query page returned without a cursor
(`N_NO_CURSOR`), a synced table whose groups can grow with no horizon
(`N_NO_HORIZON`), and a merge past 50 lanes (`N_WIDE_MERGE`).
`complete` means the query answered its declared request within known coverage and execution limits.
Filling `first N` or `last N` is complete, including a composed preview.
A cursorless page cannot continue; declare `c: cursor ?` and use `after c`
if the screen pages. Composed fields and pages covering a fitting group cap
omit `N_NO_CURSOR`.

## Operations

Nothing is priced at check. As a program runs, the meter counts examined
rows, index entries, rule probes, steps, heap bytes, output bytes and rows
written against ceilings: 8,192 rows examined, 16,384 index entries, 8,192
rule probes, 1,000,000 steps, 16 MiB heap, 1 MiB output, 1,024 rows written
per mutation; a job's chunk may examine 16,384 rows and write 8,192. A
query past a ceiling returns what it found with `complete: false`; a
mutation aborts with E_BOUND naming the meter, the ceiling and the site
(never the count: it would measure rows the viewer may not read).
Read a smaller page, narrow its predicate, or move the sweep into a job.
Authorization-dependent scans prepay a fixed logical allowance before row
discovery. Hidden candidates do not consume the caller's remaining allowance;
readable rows, filters and output still do. These logical meters exclude private
scan work: authorization candidates share one physical limit of 8,192
per request, including nested witnesses and maintained-source walks. A row behind at least 8,192 such candidates is unreachable by paging
in that direction; an empty page has no cursor into the hidden range. Expiring
cap checks draw from that same allowance; any authorization that cannot be
established within it returns generic E_RULE without identifying a cause.
The device's separate prediction-work budget can instead queue an operation.
`snapback4 check --cost` prints each site's structural class;
`snapback4 test` prints the numbers on your data and names query/persona reads
past half any ceiling without a cut: at most ten lines and a count of the rest.
Loopback `dev` logs actual meter and word cuts with the operation, principal,
site, counters and `snapback4 why <op>`. Repeats are suppressed per operation
and site (at most two lines per minute); the next emitted line includes the
suppressed count. `serve` neither logs these costs nor returns read meters.
A loop is bounded
by a page's `first N`, a schema-capped prefix, a query's meter-bounded prefix, a list's `<=N`, `range`'s int expressions, `walk`'s depth,
or `tokens`' 64. An accumulated list is bounded by the heap meter and its
iterations by the step meter. `while` stays refused.
`range(a, b)` evaluates int expressions once and iterates under the step meter,
without materializing the range. `check --cost` prints `steps ≤ meter`, a
filtered scan as `filter over ≤ examined ceiling`, its reads as `probe × examined`,
and a seek as a prefix. Sorting or grouping a page only processes that page.
`sha256(text)` charges the input's UTF-8 byte length plus one to steps before
hashing, then 64 heap bytes for its fixed lowercase hexadecimal result. A step
cut refuses a scalar query with E_BOUND; a cut on that result allocation leaves
the client observation `loading`, as other query heap cuts do. A mutation rolls
back on either cut.

### Measuring a growth curve

Use the same backend, query arguments, principal, build and host at each corpus
checkpoint. Keep warm-up policy and sample count fixed. Record corpus size,
completeness/cuts, jobs/replay mode and concurrent writers separately. Reset
before each checkpoint, run the probes, then read `doctor --latency --json`.
Repeat the curve, including checkpoints in a different order when possible;
keep every sample rather than selecting the fastest run.

This runnable Node recipe uses three warm-ups then twenty sequential measured
reads. Set the operation, arguments and persona for your app (or replace the
persona header with your ordinary bearer token); use the loopback URL printed
by `dev`. Save each checkpoint's two output files under distinct names.

```sh
# Growth curve checkpoint (run from the backend project, with dev running)
export SB4_URL=${SB4_URL:-http://127.0.0.1:4400}
export SB4_OP=${SB4_OP:-home}
export SB4_ARGS=${SB4_ARGS:-'{}'}
export SB4_PERSONA=${SB4_PERSONA:-alice}
snapback4 doctor --latency --reset --url "$SB4_URL"
node --input-type=module > checkpoint-probes.json <<'JS'
import { loadavg, cpus, hostname, platform } from 'node:os';
const samples = [];
const host = () => ({ at: Date.now(), load: loadavg(), cpus: cpus().length });
const before = host();
for (let i = 0; i < 23; i++) {
  const start = performance.now();
  const response = await fetch(`${process.env.SB4_URL}/q/${process.env.SB4_OP}`, {
    method: 'POST', headers: { 'content-type': 'application/json',
      'x-snapback-persona': process.env.SB4_PERSONA },
    body: JSON.stringify({ args: JSON.parse(process.env.SB4_ARGS) }),
    signal: AbortSignal.timeout(30000),
  });
  const reply = await response.json();
  const client = performance.now() - start;
  if (!response.ok || !('data' in reply) || reply.data === null)
    throw Error(JSON.stringify(reply));
  const header = response.headers.get('server-timing');
  if (!header) throw Error('use loopback dev for Server-Timing');
  const server = Object.fromEntries(header.split(',').map(metric => {
    const [name, duration] = metric.trim().split(';dur=');
    return [name, Number(duration)];
  }));
  samples.push({ warmup: i < 3, client, server, header,
    complete: reply.complete, cut: reply.cut });
}
const p95 = values => values.sort((a, b) => a - b)[Math.ceil(values.length * .95) - 1];
const measured = samples.filter(s => !s.warmup);
const p95ms = Object.fromEntries(['client', 'total', 'wait', 'engine', 'cpu'].map(key => {
  const values = measured.map(s => key === 'client' ? s.client : s.server[key]);
  return [key, values.every(Number.isFinite) ? p95(values) : null];
}));
console.log(JSON.stringify({ hostname: hostname(), platform: platform(),
  before, after: host(), p95ms, samples }, null, 2));
JS
snapback4 doctor --latency --json --url "$SB4_URL" > checkpoint-server.json
```

Each response from a loopback-bound `dev` listener that passes the loopback
peer/Host/Origin fence has `Server-Timing` durations in milliseconds:
`total` is acceptance (after HTTP headers, before body buffering and worker
admission) to response-header construction; `wait` sums reader checkouts and
writer lock acquisition, including connection opening; `engine` is wall time
owning a reader/writer for engine work, including authentication and head reads, excluding reader acquisition;
`cpu`, when supported, is CPU consumed by this request thread since it started.
Engine time includes descheduling and store I/O. CPU overlaps the other times;
it is not another phase to add. Synchronous `/dev/clock/advance` maintenance
counts in these timings; listener, background-thread and client CPU do not.
Zero engine time can mean a request was refused before acquiring an engine.

`doctor --latency` shows p50/p95/p99/max for total, wait, engine and CPU;
`--json` gives these distributions and `n`, `refused`, `cpu_n` (available CPU
samples). With no requests, text says `cpu n=0` and JSON has an empty CPU
distribution (zero percentiles, `cpu_n: 0`). With requests but no CPU samples,
text says `cpu unavailable` and JSON has `cpu: null`; the header omits `cpu`.
Doctor's total ends after final
response write/flush, unlike the header, which cannot measure future delivery.
For streamed assets and heartbeat polls the header is only the work before
streaming; doctor includes the stream/hold through its final flush. These are
HTTP request times, not completion times of asynchronous actions/jobs. Requests
aborted at admission have no response/header but still count as refused.

Compare client and server p95s and the paired samples: high client time alone
can be transport/client work; high server wall time with low CPU can be
scheduling, lock or I/O wait; high acquisition wait identifies checkout/lock
pressure. High CPU indicates request-thread work. Their differences alone do
not prove which OS wait occurred. Compare host load with available CPUs and
other processes; load average also includes uninterruptible I/O on Linux.
The recipe records load before/after; sample it throughout longer runs too.

The doctor histogram has up to 5% bucket error (maxima are exact), includes
warm-ups in this recipe and all other requests in its window. Per-response
samples preserve exact pairing, rounded to 0.001 ms. Twenty samples give a
noisy p95: a few adjacent slow reads can decide it. A flat curve can fail a
midpoint interpolation test because of noise; do not change the rule or call
a single passing run proof. Timings describe this workload, not a guarantee,
an asymptotic bound, or 1,000-conversation acquisition evidence.

The header carries only durations, never counters, rows, arguments or principals.
It is exposed to permitted loopback dev browser origins; `serve` does not add it.
Phase and CPU timings reveal more than total response time (and doctor aggregates
other principals’ requests); the headers are acceptable only on loopback-bound
`dev`, where the developer already holds the store, and never appear on `serve`.
This is not a claim of constant-time execution.
Existing authorization and meter disclosure rules still apply.
`doctor` summarizes the slowest few operations. Reset is dev-only; windows
start at startup/reset and exclude old in-flight arrivals. Persisted dev is
discovered through its store address; `--fresh`/`--memory` need the printed
`--url` and matching project. `GET /dev/latency` on `serve` still requires a live
service token; it cannot reset.

### The scale certificate

`check --verbose` or `check --cost` summarizes how many operations are constant, which
are constant once background cleanup catches up, and which grow with data. A
`backlog` verdict reads `scale: constant once background cleanup catches up;
until then at most N rows examined: <what the cleanup removes>`, and its
certificate keeps the read meter's allowance. `check --cost` starts each operation with its verdict;
`check --json --cost` puts the same certificates in `scale`, including
`class` (`constant`, `backlog` or `grows`), `bounds`, `growth_sites` (site,
reason and rewrite, with `backlog: true` on a site that background cleanup
removes), and `per_write`.
A growth site's rewrite is empty when the shape needs no suggested change.
The existing cost details follow each verdict.

Filters and reads quote their authored text, including parentheses; generated
expressions preserve precedence. Planner indexes appear by their columns,
such as `index (org, at), chosen by the planner`. `--verbose` keeps canonical
`$intent:` names; `check --json --cost` also retains them in `plans`, keyed
by operation and read site.

`scale: constant — at most 21 rows examined, 0 probes, 0 lanes` means the
work is independent of corpus size for the declared input bounds. A page
includes its lookahead; a merge includes opening and refilling every lane,
even when lanes overlap, and repeats their authorization allowance. Each
mutation or job scan also includes admission. A walk includes its seed at
depth zero. Shapes and loops multiply their nested reads. A value obtained
by a point read can still make a later range grow with data, including when
assignments carry that value across loop iterations.
Argument bounds appear in JSON. `scale: grows with posts in the domain
posts` means a larger domain can cost more, until a runtime meter cuts it.
The two queries above demonstrate the classes.

To make a growing read constant, pin its filter column in the indexed
domain, add a maintained view for a total, or cap the domain when that cap
is a product rule. A page size alone does not bound rows skipped by a
residual filter, a per-row read rule or expiry. Search's word expansion
and additional terms also depend on the data. A point lookup that passes
expired siblings is a cleanup backlog, and one that recomputes a maintained
aggregate over expiring contributions grows. The certificate names these
cases.

A finite ranked window whose only residual predicates are its time endpoints
says `grows with posts rows in the window's two edge hours`, with its lane
count and page size. For `.at > now - 24h and .at <= now`, ordered by
`.likeCount, .at`, that is at most 25 hour lanes and the requested page.
Interior buckets are entirely inside the window. Work also includes opening
and refilling lanes, their lookahead and repeated edge-row skips; it grows
with edge-hour density, not total history. Day windows say edge days. This
remains `class: grows`, with the conservative examined-meter allowance:
there is no fixed bound on rows per hour or day. No filter-pinning rewrite
is suggested for the exact endpoints. Additional residual predicates,
per-row read rules and nested reads retain their own growth costs, and
expiry its cleanup backlog.

Expiry skips say `expired messages rows not yet swept`. The server's expiry
sweep runs on a one-second maintenance tick and removes at most 2,000 rows
per pass across tables. This is a cadence, not a maximum age or size of the
backlog: a burst of 2,001 expirations leaves at least one row after a pass,
and downtime, slow maintenance or a failed sweep can leave older rows.
Reads remain metered and expired rows remain invisible on every host.
For an admitted server mutation (guide programs), pages, prefix `exists` and
`count` include this work and the scan-attempt charge under the examined
ceiling. Even `first 1` can refuse `E_BOUND` with no write; shrinking its
page cannot remove the backlog. For delivery reports, `E_BOUND` is an ordinary
non-retryable refusal: the SDK calls `onDeliveryRefused` once and parks the
interval until the next start, which retries with a new id. There is no retry
within the session. A committed report that runs again is a no-op report
(`why E_BOUND`, `guide receipts`).
An operation says `class: backlog` only when cleanup explains all of its
variable work: constant once the sweep catches up, and bounded by the read
meter while a backlog lasts, so the certificate keeps the meter allowance.
Beside a residual filter, a per-row read rule or a window, an expiry scan
stays `class: grows`, and its expiry site still says what cleanup removes. A
page size and the sweep interval alone cannot certify a fixed cost. The paved
Following read says `class: backlog` for the same reason: its only filter is
the platform's retirement check, an unfollow or a removal retires feed
entries, and background cleanup purges them in chunks of at most 256. A scan
of the owned feed table with a filter of your own grows: the certificate
trusts only the compiler's expansion of a timeline read. Point lookups may
still suggest reading by id to avoid skipped expired siblings.

Jobs say `scale: per chunk`; the number of chunks and rows written by the
whole sweep can still grow with its domain. Maintained aggregates, recorded
attribution and Following work appear as per-write costs in the verdict.
Writes use their shared meter allowance, including implicit engine work.
Native modules and external action handlers conservatively say `grows`:
their bodies have no Quarry structure from which to prove independence.

This is a structural certificate, not a latency or complete-result promise.
Its row, probe and write allowances include charges that trigger a refusal;
they can exceed the runtime ceilings shown separately in JSON. Steps, heap
and output can still cut a constant operation. It does not price bytes or steps at
check, change authorization, or replace measurements on your data.

Default text `check` gives note summaries with code and site.
`check --verbose` adds rewrites, `why` commands and explanations once per code
and card; `why <code>` opens one on demand. Grouped notes show one-line
summaries; verbose and JSON retain every member and source site.

When the same error code and card occur twice in one text `check`, its card excerpt
prints once under the first occurrence, with the `guide:` pointer kept at
every site. At most three excerpts print per check, each at most 4,096 UTF-8
bytes including its full-card pointer and final newline (12,291 extra bytes
including separating blank lines). A single occurrence stays compact;
`check --json` keeps its structured diagnostics. `why <code>` still opens
the excerpt on demand. Every registered code has a dedicated paragraph on
its default card; `why <code>` names the code and explains it there.
For example, `E_QUARRY_SYNTAX` and `E_QUARRY_UNKNOWN` have mistake-and-repair
sections on `guide language`; `E_QUARRY_PLACEMENT` and `E_EMIT_IN_QUERY`
have theirs on `guide programs`. A diagnostic may point to another card
for its context; if that card lacks a section for the code, `check` keeps
the diagnostic and pointer without an excerpt. Explicit `why <code>`
then labels its fallback to that card's opening.

## Refusals

E_QUARRY_BOUND means a boundless prefix is not valid in this position: no
schema cap covers the group, its cap exceeds the examined ceiling, or a
meter-bounded query prefix has a non-uniform read rule. Declare `cap N by cols`
on the table if that is the intended group limit, then read `t where .group = group`, or
page with `first N` and a cursor. For a non-uniform prefix, the rewrite also
names the index columns to pin, as N_NEVER_COMPLETE does. A returned seek page still writes
its page size. Descending reads keep `last N`.

When a helper is shared with a job, its viewer-query callers inherit query bounds and viewer authority.
The non-uniform meter refusal names the failed loop and caller chain. If the viewer preview is unused, the diagnostic points at that query's declaration and gives its full line range; paste the printed comment over those lines. The complete job and helper stay intact. This removal is a product choice, so `check --fix` does not apply it. Pinning a
principal in a membership loop does not decide a conversation-based read rule.
`first 50` is a partial preview, not an equivalent complete digest: use a
separately named paged per-chat preview with `c: cursor ?` and follow its
cursor, or keep the complete scheduled job under its system chunk meter.
Inner recipient work must fit one chunk even when the outer sweep adapts;
an oversized recipient parks rather than committing a partial digest.
A helper never grants system authority to a query. See `guide jobs`.

### Loops and scans

E_UNBOUND_LOOP means the compiler cannot establish an accepted loop domain
or walk depth. For example, `walk nodes[root] up .parent depth 100` exceeds
the supported depth of 1–64; use `depth 8` for an eight-hop query. Iterate
a bounded page, a bounded list argument, `range(a, b)` or `tokens(text)`
for ordinary loops. A `range` may use int expressions and still runs under
the step meter; there is no `while` form.

E_UNBOUND_SCAN means a compiled scan names a table or index absent from its
schema. Recompile after changing a table or its access plan:
`snapback4 check`, then use the regenerated backend together with its
programs. Do not reuse old compiled programs against a new schema.
Compiling and serving refuse it, and a native device checks again; the web device trusts that admission and does not repeat the check, so a hand-built or corrupted backend can still run there.

E_FANOUT means a loop received more items than its declared bound.
For example, a raw program declaring a ten-item loop cannot consume an
array of eleven items. Keep the producer and loop bound consistent; in
Quarry, iterate a bounded list or an explicit `first 10` page and process
remaining work through another page or a job chunk. Increasing a runtime
meter ceiling is not the repair, and silently dropping required work is
not a complete sweep."##;

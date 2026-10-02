# Round-4 scheduling and regression boundaries

Round 3 (3ed1e1c2c4) held a FIFO maintenance gate while a demoted bulk thread
waited for the engine or executed a chunk. Its aged fallback needed that same
gate. Suspending the bulk thread could therefore strand ordinary maintenance
with the engine free; ordinary writers could also wait behind a demoted owner.
The operator explicitly replaces that policy with ordinary priority and pacing.

## Lock and ordering argument

All lifecycle-managed server threads use the ordinary maintenance priority:
maintenance, bulk-maintenance, source watcher and worker supervisor. The last
two also access the engine, so changing only bulk would leave other demoted
engine holders. HTTP/intake remains user-initiated on Darwin and inherited nice
on Linux. Separate Node/watchdog processes and output-only helpers retain their
existing demotion. The server never attempts a privileged Linux nice restore.

A bulk slice first checks eligibility with a short gate access, releases it,
and enters `engine.background()`. After admission it checks again and reads the
shared next-kind cursor. The engine, not the gate, then serializes the chosen
chunk's commit and cursor advancement. State updates hold only the short gate;
no gate spans engine admission, the chunk, publication or a pacing sleep.
Ordinary work likewise admits to the engine before checking clock-drain state.
This preserves delivery-before-recount and permits ordinary slices to interleave.
Recount basis/delta logic permits later deliveries; global queue emptiness is
not a prerequisite. Ordinary schedule boundaries remain separately atomic.

Clock callers copy a separate advance mutex out of state and serialize only
with each other. After taking the engine they set `advancing` and extend leases
atomically with the clock update. Periodic engine work checks the marker after
admission and defers; ephemeral sweep coordinates only its short clock-sensitive
section. The request runs the same synchronous full drain and retains its QoS.
The unwind guard clears the marker and resets delivery-first ordering. Asset
retirement stops if a clock drain takes over, leaving durable metadata for that
drain or a later sweep rather than spinning on skipped admissions.

The stall regressions run a real bulk slice on a named thread, with a per-engine
`cfg(test)` pause inside `engine.background()`. With the engine free, real
ordinary expiry completes before bulk resumes. With the bulk guard held, the
gate remains available and ordinary admission joins the engine FIFO; expiry
completes after release. **The latter does not claim that two engine chunks run
simultaneously.** An externally stopped exclusive engine owner necessarily
blocks other engine users. The production binary contains no pause hook or
scheduler-selection environment variable. Existing engine FIFO and latency
regressions remain; clock/replay/lifecycle coverage checks shutdown and restart.

## Pacing and minimum progress

The existing queued/recent-request engine signal selects 250 µs; otherwise the
budget is 2 ms. A cached `getloadavg` sample also selects contention when the
one-minute OS average reaches available logical CPU count. This sees detached
reader pressure and other tenants, but deliberately makes no instantaneous
CPU-saturation claim. Sampling is at most every 100 ms, outside the state gate.
A failed host sample leaves engine contention as the operative signal.

After a contended bulk slice, or one during which engine waiters arrive, the
worker sleeps for seven times consumed thread CPU time, capped at 100 ms,
with no shared lock. The next engine admission is still FIFO. Request commits
do not cancel the pause. For short ordinary slices this targets 1/8 duty; the
pause cap and atomic overruns mean it is not a universal duty cap. There is no
minimum pause that would overcharge a cheap or empty turn. The thread CPU clock
excludes time already spent descheduled or asleep; if a sample fails, pacing
falls back to the more conservative wall duration. Chunk deadlines still use
wall time. A real-clock regression proves that sleep does not count as CPU work.
Empty recount/job kinds do not insert a 100 ms idle between active deliveries;
only an entirely empty three-kind cycle waits for new work.

After one second without a completed bulk turn, ordinary maintenance runs the
next turn itself. It checks on the 100 ms loop and after every ordinary engine
slice. Thus the conservative minimum service opportunity remains one turn per
1 s plus up to 100 ms polling, each kind within three such turns, independent
of a stalled bulk thread before admission. Actual dispatch adds FIFO work
already ahead, OS scheduling, atomic work and commit/filesystem delays, or an
explicit synchronous clock drain. There is no hard wall-clock completion bound
under OS starvation or stalled I/O. Finite healthy work drains; parked/failing
work needs repair, and selection within each bulk kind retains its existing
schema/FIFO order rather than gaining fairness under unbounded new arrivals.

## Cooperative chunk limits

Recounts now propagate an elapsed-time budget into both ordinary and expiring
source walks. They stop between complete candidates, including noncontributing
rows, and commit the cursor and total together. The two expiring ranges share
the time budget. A zero budget still permits one candidate so progress cannot
stop permanently; regression checks a one-row total/cursor advance for both
source kinds, then exact settlement. All fields and clock checks are SQLite-only;
the device interpreter does not acquire a clock or extra runtime field.

Delivery and Quarry sweeps retain their existing between-row checks. Atomic
setup, one row, a transaction commit and filesystem calls may overrun. Native
calls cannot preserve a transaction and suspended guest stack across commits:
the guest's `Next::Again(state)` is the durable yield point. At most **one**
native invocation runs per slice, even with zero duration. It has the unchanged
2,000,000,000 instruction-fuel limit and job meter: 1,000,000 host steps, 16,384
examined rows, 16,384 index entries, 8,192 rule probes, 8,192 writes, 16 MiB heap,
1 MiB output. Resource refusal rolls the chunk back and parks the job. These
bounds do not translate to a 250 µs or 2 ms wall-clock guarantee. The guide and
method documentation state that exception, and pacing charges the CPU consumed by a native
overrun (subject to the 100 ms pause cap). The native continuation test
runs its first 100-row invocation with zero duration and confirms that only one
invocation commits; the explicit 8,192-write refusal test verifies rollback.

## Linux failure reporting

Failed `setpriority` calls record `niceFailures`, class, errno and Unix-ms time,
without replacing Darwin's independent startup readback or QoS count. `doctor`
marks either kind of setter failure as a scheduling problem. The separate
watchdog includes its nice refusal in the private PID handshake; the owner
records `worker-nice`, so process separation does not hide that failure from
the host. Unit controls use a real invalid-selector syscall and a controlled
watchdog response. An actual doctor executable is checked against nice-only
failure status with both successful and absent HTTP startup readback.

No lease duration, retry/deadline policy, schedule coalescing, durability mode,
resource ceiling, admission capacity, reader custody or answer meaning changes.
The delivery throughput issue remains independent of this scheduler revision.

Linux priority readback is derived from the existing observer's retained
`/proc/<server>/task/<tid>/sched` snapshots in the zero-load mixed cells, with
no extra server requests during the sample. `qualification/linux-priorities.json`
records bulk/maintenance nice 0/0 for paced and 5/0 for split. Linux output helper
threads can inherit the supervisor's display name `worker`; those nice-5 pipe
threads do not hold the engine. No Darwin runtime readback is claimed here.

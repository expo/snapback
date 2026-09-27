1. **Medium — Non-loopback binds still emit timing headers.**
   [snapback4/crates/snapback4/src/serve.rs:413](/home/ccheever/sb4-intent/review-se-r0-astra/snapback4/crates/snapback4/src/serve.rs:413)

   Header eligibility checks the peer, Host and Origin, but not the listener address. I reproduced this with `dev --bind 0.0.0.0 --i-understand-cleartext`: a loopback `POST /q/read` returned all four timings. External-peer requests were correctly refused without the header.

   **Smallest fix:** also require the actual listener address to be loopback. Add wildcard-bind tests covering both loopback and external connections.

2. **Medium — Reader acquisition is classified inconsistently across operations.**
   [snapback4/crates/snapback4/src/serve_changes.rs:34](/home/ccheever/sb4-intent/review-se-r0-astra/snapback4/crates/snapback4/src/serve_changes.rs:34)

   `/changes` opens readers directly, bypassing the acquisition timer in `Shared::reader`. Ephemeral mutations similarly bypass it at [serve_ephemeral.rs:185](/home/ccheever/sb4-intent/review-se-r0-astra/snapback4/crates/snapback4/src/serve_ephemeral.rs:185).

   Injecting a 150 ms delay into request-thread SQLite opens produced:

   | Request | Wait | Engine |
   |---|---:|---:|
   | Query | 150.253 ms | 0.589 ms |
   | `/changes?wait=0` | 0.000 ms | 151.222 ms |

   Thus `wait` does not consistently include reader creation as documented.

   **Smallest fix:** instrument every reader acquisition, including direct opens and pool `take`, with the same acquisition helper. Test delayed opens on these paths.

3. **Medium — Responses that suppress CORS also lose timing headers.**
   [snapback4/crates/snapback4/src/serve.rs:585](/home/ccheever/sb4-intent/review-se-r0-astra/snapback4/crates/snapback4/src/serve.rs:585)

   Timing insertion lives inside `cors()`, which `respond_with_sync` skips when `allow_origin` is false. With a loopback dev fixture declaring `route webhook: post "/hook" as service:hook`, a persona request returned HTTP 401 without `Server-Timing`. `/dev/token` refusals likewise omitted it. These requests passed the timing fence.

   **Smallest fix:** attach timing independently of CORS authorization, retaining the existing timing eligibility check. Cover route refusals and pending responses.

The disclosure qualification matters: phase and CPU timings **do reveal more than total elapsed time**. A paired hidden-row test returned identical data and logical meters, while median CPU changed from 0.067 to 0.331 ms with hidden payload size. Wait also separates contention from request work; doctor aggregates other principals’ requests. The report correctly acknowledges additional timing information. I found no production header exposure, and production aggregate inspection retains its live-service credential check.

The measurements are otherwise sound. I independently checked all 14,400 measured samples and reproduced the quoted p95s. They support an added off-CPU tail under contention and no observed reader blocking in the tested conditions. They cannot establish calibration #23’s historical cause or sustained overlapping-write behavior; the report states those limits. The recipe runs, aliases have no collisions, and the SS figures preserve the measured methods, host and unmet browser target.

Validation passed using the lane’s existing build artifacts: 23 latency tests, 10 doctor/recipe tests and 89 guide tests. Forced CPU-clock failure correctly omitted the header field and returned `cpu: null`, `cpu_n: 0`. The overhead test measured approximately 3.4 µs median overhead here.

**Surviving mutation:** deleting the `/changes` refresh `EngineSpan` at [serve_changes.rs:38](/home/ccheever/sb4-intent/review-se-r0-astra/snapback4/crates/snapback4/src/serve_changes.rs:38) would survive the current assertions: they check header presence and total duration, not attribution of refresh work. Add a controlled refresh delay and assert its inclusion in engine time and exclusion of poll sleeping.

**READY WITH CHANGES**

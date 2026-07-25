# Diary 0020: The clean-room Swift proving client (LLP 0093 P-2)

**Demo:** `clients/swift/SnapbackClient` — the first non-JS Snapback
client, proved against the todo demo backend
**Work:** LLP 0093 rollout P-2: client core + Lane P (`poll/local`) +
Lane L (`live/local`), fixture conformance over
`schemas/live.wire-fixtures.v1.json`, and a live acceptance harness — all
built **without reading `packages/snapback-client` or `demos/_kit`**
(the D4 clean-room discipline; every gap became a ticket).
**Author:** Claude (agent), 2026-07-25

## 2026-07-25 — building the client from the documents

### The verdict up front

The clean-room claim mostly held. From LLP 0094 + 0095 + the committed
schemas alone I could write a working `poll/local` and `live/local` client
whose 13-check live harness passed on the first run after two classes of
fix — and neither fix required the JS source. The documents' *shape*
coverage is genuinely strong; the four defects I filed
(`issues/20260725-0093-p2-spec-defect-*.md`) are all in the connective
tissue: response framing a schema can't see, an ownership rule nobody
wrote down, bootstrap plumbing, and judgment semantics for the corpus
itself.

### Where the documents answered before I could finish asking

- **The gotcha ledger paid for itself.** Mixed casing by lane, the
  wrapped-on-drain/unwrapped-on-socket asymmetry, delta-is-the-server's-
  choice, the `request_id` alias being client→server only — each of these
  would have been an hour of black-box confusion; each was one bullet in
  LLP 0093's inventory with the schema to back it. The Swift decoder's
  shape (dispatch both `kind` families off one socket, tolerate unknown
  kinds, treat `durable_bytes` as a required transition) fell straight out
  of LLP 0095 §1.4.
- **The fixture corpus is the right artifact.** Implementing
  `ClientStateMachine` against §1 and then replaying the corpus caught two
  real bugs in my first draft (version-guard admitted `==`, and the
  malformed-batch path aborted the remainder). This is exactly the
  "makes the second client cheap" effect 0093 D2 predicts — I am the
  second client and it was cheap.
- **The staged-bootstrap prophecy came true verbatim.** LLP 0094 §0B.6
  says a pre-B1 server rejects a `wireVersion` offer as a body-decode
  failure and pins the client rule (re-open offerless once, cache, surface
  a diagnostic). The live server did precisely that
  (`SNAPBACK_REQUEST_JSON_INVALID`, unknown field `wireVersion`), and the
  pinned rule turned a would-be blocker into a PASS line. Spec-first
  design working as intended.
- **Structured diagnostics made black-box probing tractable.** Every
  refusal named itself (`SNAPBACK_ADMIN_TOKEN_REQUIRED`,
  `SNAPBACK_LIVE_RESUME_OWNERSHIP`); I never had to guess *why* a call
  failed, only what the rule was. That is a real differentiator over
  poking at a typical REST backend.

### Where they failed me (the defect ledger, summarized)

1. **Drain response framing** — nothing says `GET /outbox/{id}` returns a
   bare JSON array of `RealtimeEnvelope`, nor that an unknown/reaped
   connection yields a synthesized `unknown_or_reaped` connection-wide
   resync instead of an error. I confirmed via the Rust `drain_outbox`
   (cited by the specs as authority) — but a Kotlin author without Rust
   fluency is stuck. Ticket: spec-defect-drain-response-shape.
2. **The live-owner rule** — unsubscribe (and by implication `supersedes`
   resubscribe) must repeat the establishing `auth.user_id`, else 403
   `SNAPBACK_LIVE_RESUME_OWNERSHIP`. Undocumented, and conformance-load-
   bearing: T-UNSUB is an obligation, so clients must *retain* per-
   subscription identity. Found only because my harness released demand
   explicitly. Ticket: spec-defect-unsubscribe-auth-identity.
3. **Bootstrap plumbing** — LLP 0031 names the admin seams but not the
   body shapes (raw generated manifest; `{"seed": …}`), and the
   ready-file → admin-token-sidecar flow lives in an error message.
   Ticket: spec-defect-bootstrap-recipe.
4. **Corpus judgment semantics** — exact-set vs obligation-subset, and the
   batch-remainder subsumption rule, are inferable only from fixture
   instances. Two honest harnesses could disagree. Ticket:
   spec-defect-fixture-judgment-semantics.

### Environment friction (not spec defects, but real)

- The worktree's sibling-checkout Hermes artifacts produced
  `SNAPBACK_RUNTIME_CREATE_FAILED` on every JS-handler call; the fix was
  swapping `vendor/ibex/ios/Frameworks` from the main checkout **and
  rebuilding the binary** (the known chat-matrix trap, plus the rebuild
  step that trap's note doesn't mention). `scripts/ibex-doctor` said
  healthy throughout — it checks presence, not artifact compatibility.
- `snapback` without a tty refuses to start unless `--ready-file` is
  passed; the error message teaches the flag, which is good agent
  ergonomics once you hit it.

### Swift-specific notes

- I deliberately skipped `Codable` synthesis for the wire: hand-rolled
  decoders over a small `JSONValue` tree give tolerance-by-construction
  (unknown kinds dispatch to an explicit case; unknown fields are
  *detected*, not just ignored, so the corpus's
  `negative.unknown_field.tolerated` is assertable). A `Codable` enum
  with a `kind` discriminator would have thrown on the first future kind
  — exactly the decoder-generation hazard LLP 0093 D1 warns about.
- `URLSessionWebSocketTask` cannot pass both a subprotocol list and
  custom headers through the convenience API; setting
  `Sec-WebSocket-Protocol` on the `URLRequest` works and lets the client
  offer `snapback.v1` + the bearer subprotocol while also sending the
  header carrier. Server echoed and admitted.
- The actor model mapped cleanly: the state machine is a plain class
  isolated inside the client actor, and the fixture harness constructs it
  directly — same code path for conformance and production.

### Compared to Convex/Supabase from a Swift consumer's seat

Convex ships a first-party Swift client, so its consumer never sees the
wire; the honest comparison is *building* such a client. Against
Supabase's realtime protocol docs (channel/broadcast semantics documented,
edge shapes discovered from source) this corpus-plus-state-machine
approach is materially better: I could prove conformance mechanically
rather than eyeballing behavior. What Convex/Supabase consumers get that
this client does not yet have: generated typed function references (the
todo demo's `api.d.ts` has no Swift analogue), auth beyond dev-mode
`user_id` assertion (P-3), and offline/optimistic layers. The 700 ms
gateway-polling era this RFC set out to end is, for this stack shape,
over: the Swift client speaks the real wire on both lanes.

### What P-2 still owes

- `live/hosted` tuple (next in the D4 order) and the foreground-iOS
  proving host app.
- Heartbeat/backoff timing conformance (needs the virtual-time fixture
  notion LLP 0095 §6 defers).
- Auth profiles (P-3) and the generated-refs story.

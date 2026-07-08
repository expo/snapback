// The deployed handler Worker (LLP 0040 §App subset): the single-sourced
// LLP 0048 harness, with the notes app bundle compiled in at deploy time.
//
// Import order is the security posture (identical to the twin's entry.mjs):
// the global strip evaluates first, then the rejection ledger, the allowlist
// installer, the ctx bootstrap, and finally the app bundle — into an
// already-stripped global scope. The invocation fetch server is single-sourced
// with the twin (handler-server.mjs). This isolate has NO ambient authority
// and NO Durable Object storage handle: its only power is the epoch-carrying
// host-call channel to the coordinator, verified by the ambient-power denial
// test.
import '../../packages/snapback-harness/workerd/strip.mjs';
import '../../packages/snapback-harness/workerd/rejection-ledger.mjs';
import '../../packages/snapback-harness/allowlist-install.js';
import '../../packages/snapback-harness/ctx-bootstrap.js';
// The deploy-time app selector (LLP 0049 Phase 0): resolved by the build's
// 'snapback-app' alias to the same bundle the coordinator compiled in.
import 'snapback-app';
export { default } from '../../packages/snapback-harness/workerd/handler-server.mjs';

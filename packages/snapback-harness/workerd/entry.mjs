// workerd entry module for the V8 handler harness (LLP 0048 §Architecture).
// Import order is the security posture: the strip evaluates before anything
// else, the rejection ledger before the bootstrap (so the bootstrap's
// hook-slot installer defers to it), the allowlist installer before the
// handler module, and the handler module last, into an already-stripped
// global scope. The fetch server is single-sourced with the LLP 0040 deploy
// handler Worker (handler-server.mjs).
import "./strip.mjs";
import "./rejection-ledger.mjs";
import "./allowlist-install.js";
import "./ctx-bootstrap.js";
import "./handler.mjs";
export { default } from "./handler-server.mjs";

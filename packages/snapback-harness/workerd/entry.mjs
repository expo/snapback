// workerd entry module for the V8 handler harness (LLP 0048 §Architecture).
// Import order is the security posture: handler-server consumes the strip's
// one-shot intrinsic capability and installs its closure-private rejection
// ledger before anything application-controlled evaluates. The allowlist and
// bootstrap then install before the handler module, which remains last. The
// fetch server is single-sourced with LLP 0040's deployed handler Worker.
import handlerServer from "./handler-server.mjs";
import "./allowlist-install.js";
import "./ctx-bootstrap.js";
import "./handler.mjs";
export default handlerServer;

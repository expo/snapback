// Egress-seam + config-handle probe handlers. `fetchState` is "available" when
// the native fetch global returns a promise (the deny stub throws synchronously
// instead), so it cleanly distinguishes "un-denied" from "denied" without
// touching the network. The config facts exercise the LLP 0036 handle API: the
// exposed values here are test literals, returned so the acceptance test can
// prove the grant/rotation/import path end to end — a real app never returns
// exposed material.
// Port 65534 is intentionally ordinary (not on the Fetch Standard's blocked
// port list). The probe observes only the returned promise and never awaits or
// depends on a listener, so it still performs no external network I/O.
const EGRESS_PROBE_URL = 'http://127.0.0.1:65534/none';

globalThis.__snapbackHandlers = {
  async egressProbe(ctx) {
    let fetchState;
    try {
      const p = fetch(EGRESS_PROBE_URL);
      if (p && typeof p.then === 'function') {
        p.then(function () {}, function () {}); // swallow the (expected) rejection
        fetchState = 'available';
      } else {
        fetchState = 'not-a-promise';
      }
    } catch (error) {
      fetchState = (error && error.message) || String(error);
    }

    const config = {};
    try {
      const handle = ctx.secrets.rotating('feedKeys');
      config.rotatingExposed = handle.expose();
      // Redaction facts: every accidental materialization path must yield the
      // marker, never the value (LLP 0036 negative acceptance claims).
      config.stringified = JSON.stringify(handle);
      config.template = `${handle}`;
      config.concatenated = 'prefix:' + handle;
      config.bearer = handle.asBearer();
    } catch (error) {
      config.rotatingError = (error && error.message) || String(error);
    }
    try {
      ctx.secrets.get('somethingUndeclared');
      config.undeclaredError = 'no error (BUG)';
    } catch (error) {
      config.undeclaredError = (error && error.message) || String(error);
    }
    return { fetchState, config };
  },

  async queryProbe(ctx) {
    let fetchState;
    try {
      const p = fetch(EGRESS_PROBE_URL);
      if (p && typeof p.then === 'function') {
        p.then(function () {}, function () {});
        fetchState = 'available';
      } else {
        fetchState = 'not-a-promise';
      }
    } catch (error) {
      fetchState = (error && error.message) || String(error);
    }
    // Queries get no config surface at all (LLP 0036 D4/D5).
    const secretsState = typeof ctx.secrets === 'undefined' ? 'undefined' : 'PRESENT (BUG)';
    return [{ fetchState, secretsState }];
  },
};

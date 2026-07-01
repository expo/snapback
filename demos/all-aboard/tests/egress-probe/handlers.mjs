// Egress-seam probe handlers. `fetchState` is "available" when the native fetch
// global returns a promise (the deny stub throws synchronously instead), so it
// cleanly distinguishes "un-denied" from "denied" without touching the network.
globalThis.__snapbackHandlers = {
  async egressProbe(ctx) {
    let fetchState;
    try {
      const p = fetch('http://127.0.0.1:9/none');
      if (p && typeof p.then === 'function') {
        p.then(function () {}, function () {}); // swallow the (expected) rejection
        fetchState = 'available';
      } else {
        fetchState = 'not-a-promise';
      }
    } catch (error) {
      fetchState = (error && error.message) || String(error);
    }
    return { fetchState, secrets: ctx.secrets || null, hasSecrets: !!ctx.secrets };
  },

  async queryProbe() {
    let fetchState;
    try {
      const p = fetch('http://127.0.0.1:9/none');
      if (p && typeof p.then === 'function') {
        p.then(function () {}, function () {});
        fetchState = 'available';
      } else {
        fetchState = 'not-a-promise';
      }
    } catch (error) {
      fetchState = (error && error.message) || String(error);
    }
    return [{ fetchState }];
  },
};

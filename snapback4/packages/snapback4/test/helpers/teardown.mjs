// @ref LLP 3000.000.000.001#13-wave-26-developer-loop-repairs-dx9 — one hook drains resources before scratch removal, even after a cleanup failure.
const scopes = new WeakMap();
export function after(t, step) {
  let steps = scopes.get(t);
  if (!steps) {
    steps = []; scopes.set(t, steps);
    t.after(async () => {
      const errors = [];
      for (const cleanup of steps.reverse()) {
        try { await cleanup(); } catch (error) { errors.push(error); }
      }
      if (errors.length) throw new AggregateError(errors, `test teardown failed: ${errors.map(String).join('; ')}`);
    });
  }
  steps.push(step);
}

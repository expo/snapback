// Review-requested negative controls, applied in memory to the built scheduler.
// SY_SYNC_MUTATION=false|ok|background; neither source nor dist is edited.
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const mutation = process.env.SY_SYNC_MUTATION;
assert.ok(["false", "ok", "background"].includes(mutation));
registerHooks({ load(url, context, next) {
  const result = next(url, context);
  if (!url.endsWith("/packages/snapback4/dist/local-sync.js")) return result;
  let source = String(result.source);
  const replace = (needle, replacement) => {
    assert.equal(source.split(needle).length, 2, `one mutation site: ${needle}`);
    source = source.replace(needle, replacement);
  };
  if (mutation === "background") {
    replace("let followUp;", `let followUp;
    const explicitRounds = new WeakSet();
    const explicitOnce = () => {
      const round = once();
      explicitRounds.add(round);
      return round;
    };`);
    replace("return once();", "return explicitOnce();");
    replace("if (followUp?.after !== prior)", "if (!explicitRounds.has(prior)) return prior;\n        if (followUp?.after !== prior)");
    replace("prior.then(once, once)", "prior.then(explicitOnce, explicitOnce)");
  } else {
    replace("prior.then(once, once)", `prior.then(ok => ok ? once() : ${mutation}, once)`);
  }
  return { ...result, source };
} });

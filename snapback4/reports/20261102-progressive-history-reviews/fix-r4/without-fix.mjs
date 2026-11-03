import { registerHooks } from 'node:module';
const missing = process.env.SB4_FIX_R4_WITHOUT;
registerHooks({load(url, context, nextLoad) {
  const result = nextLoad(url,context);
  const name = missing === 'startup' ? '/dist/local.js' : '/dist/local-runtime.js';
  if (!url.endsWith(name)) return result;
  let source = String(result.source), prior = source;
  if (missing === 'startup') source = source.replace('await acquisitionWalk.sync(network.once, network.once, () => !closed && !sessionDead && !versionBlocked() && coreReady)', 'await network.once()');
  if (missing === 'restore') source = source.replace(' && !progressiveState(captured.ok)?.replacement_required', '');
  if (missing === 'fallback') source = source.replace(/const acquireBound = [^;]+;/, 'const acquireBound = false;');
  if (missing === 'cursor') source = source.replace('const acquisition = acquisitionRequest ?? env.acquisitionWalk.request', 'const acquisition = env.acquisitionWalk.request');
  if (source === prior) throw Error(`counterfactual did not remove ${missing}`);
  return {...result, source};
}});

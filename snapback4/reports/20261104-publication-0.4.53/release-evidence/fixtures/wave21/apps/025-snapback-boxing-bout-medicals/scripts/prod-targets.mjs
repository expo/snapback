// Release-target discovery for production moves. v1 is the first-ever
// deployed release (the first deploy event, previous === null); v2/forward
// is "latest". Falls back to 1 when history is unavailable.
import { DIR, cli } from "./prod-lib.mjs";

export async function releasesInfo() {
  let after = null;
  const events = [];
  for (let i = 0; i < 20; i++) {
    const args = ["releases", DIR, "--json"];
    if (after != null) args.push("--after", String(after));
    const r = await cli(args);
    if (r.code !== 0) throw Error(`releases: ${r.stderr.slice(0, 300)}`);
    const parsed = JSON.parse(r.stdout);
    events.push(...(parsed.events ?? []));
    if (parsed.events_after == null) return { ...parsed, events };
    after = parsed.events_after;
  }
  throw Error("releases: too many events to page");
}

export async function v1ReleaseId() {
  try {
    const info = await releasesInfo();
    const first = info.events.find((e) => e.previous == null && e.operation === "deploy");
    if (first != null) return first.release;
  } catch {
    // fall through to default
  }
  return 1;
}

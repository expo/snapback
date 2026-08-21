import { ADVISORY_CAP_FAMILIES, assertCapFamily } from "../sources.mjs";

export function adaptAdvisoryFamily(capFamily) {
  assertCapFamily(capFamily);
  if (!ADVISORY_CAP_FAMILIES.has(capFamily)) {
    throw new TypeError(`${capFamily} is not a cap-advisory family`);
  }
  return {
    adapter: "advisory-null",
    source: null,
    turns: null,
    unavailableReason: "harness-no-per-turn-usage",
  };
}

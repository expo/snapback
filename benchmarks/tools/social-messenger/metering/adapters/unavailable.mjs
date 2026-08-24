import { assertCapFamily } from "../sources.mjs";

const REASON_CODE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export function assertUnavailableReason(reason) {
  if (typeof reason !== "string" || !REASON_CODE.test(reason)) {
    throw new TypeError(
      "unavailable reason must be a stable lowercase kebab-case reason code",
    );
  }
  return reason;
}

export function adaptUnavailableFamily(capFamily, reason) {
  assertCapFamily(capFamily);
  return {
    adapter: "unavailable-null",
    adapterVersion: "unavailable-null.v1",
    source: null,
    turns: null,
    unavailableReason: assertUnavailableReason(reason),
    sourceIds: [],
    compatibilityEvents: [],
  };
}

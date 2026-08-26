const REDUCED_DRIVER_ID = "social-messenger-r2-native-cli-driver.v1";
const FULL_JOURNEY_DRIVER_ID = "social-messenger-full-journey-native-cli-driver.v1";
const REDUCED_MILESTONES = Object.freeze(["M1", "M2", "M3"]);
const CONTINUOUS_MILESTONES = Object.freeze(["M1", "M2", "M3", "M4", "M5", "M6", "M8"]);
const FULL_JOURNEY_MILESTONES = Object.freeze([...CONTINUOUS_MILESTONES, "M7"]);

function sameArray(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

// The registered config contains every fact needed to decide whether the
// production driver can account for a journey. Keep this pure so admission and
// the controller can refuse before consuming either form of host-lock custody.
export function resolveRegisteredJourney({ milestones, sessionShape, cell }) {
  if (sameArray(milestones, REDUCED_MILESTONES)) {
    return {
      runScope: "reduced",
      driverId: REDUCED_DRIVER_ID,
      continuous: REDUCED_MILESTONES,
      fresh: [],
    };
  }
  if (
    sameArray(milestones, FULL_JOURNEY_MILESTONES)
    && sameArray(sessionShape?.continuous, CONTINUOUS_MILESTONES)
    && sameArray(sessionShape?.fresh, ["M7"])
    && sessionShape.m7FreshSessionRequired === true
    && sessionShape.m7BackendState === "fresh-starter-only-pre-replay"
    && Array.isArray(cell?.m7Ports)
    && cell.m7Ports.length === 2
  ) {
    if (cell.harness !== "codex-sol") {
      throw new Error(
        `R2_DRIVER_FULL_JOURNEY_ACCOUNTING_UNSUPPORTED: ${cell?.harness ?? "unknown"} has no registered composable full-journey accounting contract; refusal occurs before admission or controller host-lock consumption`,
      );
    }
    return {
      runScope: "full",
      driverId: FULL_JOURNEY_DRIVER_ID,
      continuous: CONTINUOUS_MILESTONES,
      fresh: ["M7"],
    };
  }
  throw new Error(
    "R2_DRIVER_SESSION_SHAPE: milestones must be the retained M1-M3 reduced shape or the registered continuous M1-M6+M8 plus fresh-M7 full journey",
  );
}

export function resolveConfigJourney(config) {
  return resolveRegisteredJourney({
    milestones: config?.milestones,
    sessionShape: config?.harnessConfig?.execution?.sessionShape,
    cell: config?.cell,
  });
}

export const JOURNEY_CONTRACT = Object.freeze({
  REDUCED_DRIVER_ID,
  FULL_JOURNEY_DRIVER_ID,
  REDUCED_MILESTONES,
  CONTINUOUS_MILESTONES,
  FULL_JOURNEY_MILESTONES,
});

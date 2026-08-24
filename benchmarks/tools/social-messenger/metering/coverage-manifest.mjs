import { createHash } from "node:crypto";

function digest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function fail(message) {
  throw new Error(`R2_COVERAGE_MANIFEST: ${message}`);
}

export function validateCoverageManifestBytes({
  coverageBytes,
  assertionBytes,
  expectedMilestones,
  runScope,
  instrumentPin,
}) {
  const coverage = JSON.parse(coverageBytes.toString("utf8"));
  const assertions = JSON.parse(assertionBytes.toString("utf8"));
  if (
    coverage?.format !== "clique-coverage-manifest.v1"
    || coverage.instrument !== instrumentPin
    || coverage.milestones === null
    || typeof coverage.milestones !== "object"
    || Array.isArray(coverage.milestones)
  ) {
    fail("identity, instrument, or milestone map differs from the registered format");
  }
  const expectedKeys = expectedMilestones.map((milestone) => milestone.toLowerCase());
  if (JSON.stringify(Object.keys(coverage.milestones).sort()) !== JSON.stringify([...expectedKeys].sort())) {
    fail("milestone coverage differs from the registered run scope");
  }
  for (const milestone of expectedMilestones) {
    const declared = assertions.milestones?.[milestone]?.assertions;
    if (!Array.isArray(declared)) fail(`assertion manifest lacks ${milestone}`);
    const expectedIds = declared.filter((assertion) => (
      assertion.executor === "suite-required"
      && (assertion.runScope === "all" || runScope === "full")
    )).map((assertion) => assertion.id);
    const observedIds = coverage.milestones[milestone.toLowerCase()];
    if (!Array.isArray(observedIds) || JSON.stringify(observedIds) !== JSON.stringify(expectedIds)) {
      fail(`${milestone} does not map every suite-required assertion exactly once and in registered order`);
    }
  }
  return { value: coverage, sha256: digest(coverageBytes), bytes: coverageBytes.byteLength };
}

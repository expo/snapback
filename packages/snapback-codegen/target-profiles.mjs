// The closed codegen target-profile population is shared with validators that
// must reject invented profiles without loading the full codegen toolchain.
// @ref LLP 0134#2-the-promotion-evidence-bar — E2 draws every supporting
// target profile from this closed population.

export const TARGET_PROFILE_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: 'local-dev-sqlite-ibex',
    capabilityManifest: 'capability.manifest.local-dev-sqlite-ibex.json',
    outputDirectory: 'generated',
  }),
  Object.freeze({
    id: 'remote-service-sqlite-ibex',
    capabilityManifest: 'capability.manifest.remote-service-sqlite-ibex.json',
    outputDirectory: 'generated-remote-service',
  }),
]);

export const TARGET_PROFILE_IDS = Object.freeze(
  TARGET_PROFILE_DEFINITIONS.map(({ id }) => id).sort(),
);

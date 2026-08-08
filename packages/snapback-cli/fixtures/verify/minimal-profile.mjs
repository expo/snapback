// This package fixture proves the authoring contract without claiming that it
// observed an application's reads or writes. Replace this body with the real
// headless acceptance run and report complete provenance only when measured.
export async function runMinimalProfile({ artifact, profileId }) {
  if (profileId !== 'local-headless' || typeof artifact?.identity?.inputsHash !== 'string') {
    throw new Error('minimal verify profile received the wrong execution context');
  }
  return {
    ok: true,
    context: {
      target: { kind: 'local-generated-artifact', identity: artifact.identity.inputsHash },
      data: {
        kind: 'sqlite-fixture',
        identity: 'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
      },
      authority: { kind: 'dev-asserted', identity: 'user_ada', principalClass: 'dev' },
      seed: artifact.seedIdentity,
    },
    conformance: [{
      pathId: 'list-success',
      status: 'observed',
      report: {
        missingReads: [],
        missingWrites: [],
        extraReads: [],
        extraWrites: [],
        readProvenance: 'unsupported',
        writeProvenance: 'unsupported',
      },
    }],
  };
}

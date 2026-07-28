export const PUBLIC_PACKAGE_BUILD_DISTRIBUTION = 'public-package';

export function assertPublicPackageBuildIdentity(identity) {
  if (identity?.schemaVersion !== 'snapback.binary-identity.v1'
      || identity?.buildDistribution !== PUBLIC_PACKAGE_BUILD_DISTRIBUTION
      || typeof identity?.binary?.gitCommit !== 'string'
      || identity.binary.gitCommit === 'unknown'
      || identity.binary.gitDirty !== false
      || identity.binary.buildProfile !== 'release') {
    const error = new Error(
      'native runtime was not built as a clean release public-package artifact; '
      + 'without PackageCapabilityAttestationV1 the package must retain relation/activity GAPs',
    );
    error.code = 'SNAPBACK_PACKAGE_CAPABILITY_ATTESTATION_REQUIRED';
    throw error;
  }
  return identity;
}

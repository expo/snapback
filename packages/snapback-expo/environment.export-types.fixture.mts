import type { SnapbackExpoEnvironmentV1 } from '@expo/snapback-expo';

type AdoptAuthorityInput = Parameters<SnapbackExpoEnvironmentV1['adoptAuthority']>[0];

function readAdoptionOverride(input: AdoptAuthorityInput): boolean | undefined {
  return input.adoptSupervisedSession;
}

void readAdoptionOverride;

// Target-profile admission that must run before a schema can become serving
// state. Keep this pure so deploy-time bundle loading and /app/ensure use the
// same refusal, and so the target distinction is testable without loopback.

export const STRICT_DECLARATIONS_TARGET_UNSUPPORTED_CODE =
  'SNAPBACK_STRICT_DECLARATIONS_TARGET_UNSUPPORTED';

export const CLOUDFLARE_TARGET_PROFILE = 'cloudflare-do-sqlite-v8';

// @ref LLP 0146#d1-declarationobservation-conformance — strict declarations
// may never ride through a target that lacks captured-set enforcement.
export function strictDeclarationsTargetRefusal(
  schemaManifest,
  { targetProfile, enforcesStrictDeclarations },
) {
  if (schemaManifest?.strictDeclarations !== true || enforcesStrictDeclarations === true) {
    return null;
  }
  return {
    code: STRICT_DECLARATIONS_TARGET_UNSUPPORTED_CODE,
    message:
      `target profile ${targetProfile} cannot enforce strictDeclarations; ` +
      'remove the flag or use a target profile with strict-declaration enforcement',
    details: {
      targetProfile,
      option: 'strictDeclarations',
      remediation: ['remove-strictDeclarations', 'use-enforcing-target'],
    },
  };
}

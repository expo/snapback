export const CLIENT_REFERENCE_KIND_MISMATCH_CODE: 'SNAPBACK_CLIENT_REFERENCE_KIND_MISMATCH';
export const CLIENT_REFERENCE_PROFILE_MISMATCH_CODE: 'SNAPBACK_CLIENT_REFERENCE_PROFILE_MISMATCH';
export const CLIENT_REFERENCE_KIND_GUIDE: '/_snapback/guide/clients/headless.md#generated-reference-kinds-and-legal-verbs';

export function assertClientReferenceKind(input: Readonly<{
  reference: unknown;
  acceptedKinds: readonly string[];
  invokedVerb: string;
  diagnosticsChannel?: Readonly<{ emit?(event: Readonly<Record<string, unknown>>): unknown }> | null;
  acceptedAuthoringProfiles?: readonly string[] | null;
}>): void;

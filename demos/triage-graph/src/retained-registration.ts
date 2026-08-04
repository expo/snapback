// LLP 0166 OQ8 intentionally keeps programmatic registration authoring out of
// the public package surface. P3 isolates the temporary internal seam here so
// the rest of the app remains ordinary generated-reference client code.
//
// @ref LLP 0166#d2--the-sync-specification-registered-queries — a durable
// programmatic registration survives process restart and contributes to the
// same registration-derived sync set as active subscriptions.

type PreparedBridge = {
  bridge: {
    address: readonly string[];
    authorityPartitionDigest: string;
  };
};

type RegistrationClient = {
  __prepareGeneratedMaterializationBridge(
    reference: unknown,
    args: Record<string, unknown>,
    userId: string | null,
    persistResume: boolean,
  ): Promise<PreparedBridge | null>;
  __registerDurableQuery(registration: Record<string, unknown>): Promise<{
    committed?: boolean;
    refused?: { code: string };
  }>;
};

export async function retainInboxRegistration(client: unknown, reference: any) {
  const seam = client as RegistrationClient;
  const prepared = await seam.__prepareGeneratedMaterializationBridge(reference, {}, null, true);
  if (prepared === null) {
    throw new Error('SNAPBACK_TRIAGE_RETAINED_REGISTRATION_UNAVAILABLE');
  }
  const result = await seam.__registerDurableQuery({
    format: 'snapback.query-registration.v1',
    registrationId: 'triage-graph-retained-inbox-v1',
    source: 'programmatic',
    ownerContext: { kind: 'api', label: 'triage-graph-retained-inbox' },
    functionReference: {
      name: reference.name,
      materializationAddress: [...prepared.bridge.address],
      authorityPartitionDigest: prepared.bridge.authorityPartitionDigest,
    },
    canonicalArgs: {},
    requestedScope: { kind: 'page', input: { kind: 'first' } },
    retentionRequest: 'durable',
    idleTtlClass: 'default',
  });
  if (result.refused) throw new Error(result.refused.code);
  return result;
}

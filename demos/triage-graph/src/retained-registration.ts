// @ref LLP 0166#open-questions — the public programmatic registration API is
// the durable successor to the mounted-query `persistResume` stand-in.

type RegisterOutcomeV1 = Readonly<{
  format: 'snapback.register-outcome.v1';
  contextId: string;
  requestId: string;
  outcome:
    | Readonly<{ kind: 'committed' }>
    | Readonly<{ kind: 'released' }>
    | Readonly<{ kind: 'refused'; code: string }>;
}>;

type RegistrationClient = {
  registerQuery(
    reference: unknown,
    options: Readonly<{
      registrationId: string;
      args: Record<string, unknown>;
      label: string;
      requestedScope: Readonly<{
        kind: 'page';
        input: Readonly<{ kind: 'first' }>;
      }>;
      retentionRequest: 'durable';
      idleTtlClass: 'default';
    }>,
  ): Promise<RegisterOutcomeV1>;
};

export async function retainInboxRegistration(client: unknown, reference: unknown) {
  const result = await (client as RegistrationClient).registerQuery(reference, {
    registrationId: 'triage-graph-retained-inbox-v1',
    args: {},
    label: 'triage-graph-retained-inbox',
    requestedScope: { kind: 'page', input: { kind: 'first' } },
    retentionRequest: 'durable',
    idleTtlClass: 'default',
  });
  if (result.outcome.kind === 'refused') throw new Error(result.outcome.code);
  return result;
}

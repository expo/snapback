export function exactVerdict(
  verdicts: readonly any[],
  ruleHash: string,
  pinnedDigest: string,
  viewer: string,
  authEpoch: number,
): boolean | null {
  const verdict = verdicts.find((candidate) =>
    candidate.rule_hash === ruleHash &&
    candidate.pinned_inputs_digest === pinnedDigest &&
    candidate.principal === viewer &&
    candidate.auth_epoch === authEpoch
  );
  return verdict?.result ?? null;
}

export function exactByIdAbsence(
  absences: readonly any[],
  table: string,
  id: string,
  valuesEqual: (left: any[], right: any[]) => boolean,
): boolean {
  return absences.some(([candidateTable, index, key]) =>
    candidateTable === table && index === "byId" && valuesEqual(key, [{ Id: id }])
  );
}

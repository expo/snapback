export function diagnosticStreamsAreSecretFree(result, knownSecrets) {
  const streams = [result?.stdout, result?.stderr]
    .map(value => typeof value === "string" ? value : String(value ?? ""));
  return [...knownSecrets].every(knownSecret => {
    const secret = String(knownSecret);
    return secret.length > 0 && streams.every(stream => !stream.includes(secret));
  });
}

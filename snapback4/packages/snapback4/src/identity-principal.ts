import { createHash } from "node:crypto";

export function oidcPrincipal(issuer: string, subject: string): string {
  const digest = createHash("sha256")
    .update("snapback4:oidc-principal:v1\0")
    .update(issuer)
    .update("\0")
    .update(subject)
    .digest("base64url");
  return `oidc:${digest}`;
}

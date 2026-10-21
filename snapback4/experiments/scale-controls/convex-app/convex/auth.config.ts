import type { AuthConfig } from "convex/server";
// Offline fixture issuer: backend verifies RS256, issuer, audience and expiry.
// https://docs.convex.dev/auth/advanced/custom-jwt documents data-URI JWKS.
export default { providers: [{ type: "customJwt", issuer: "https://s1cx.invalid",
  applicationID: "s1cx", algorithm: "RS256", jwks: process.env.S1CX_JWKS! }] } satisfies AuthConfig;
